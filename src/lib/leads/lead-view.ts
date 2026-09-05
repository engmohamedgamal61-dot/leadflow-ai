/**
 * Generic, industry-agnostic presentation of a persisted lead.
 *
 * Real Estate, Clinic and any future industry render through this one path:
 * the core fields, then whichever template fields have a value, then any
 * leftover `custom_data` keys the template doesn't know about. No industry
 * branches, and nothing here reads a database column name.
 *
 * This module is pure (relative imports only) so it — and its test — run under
 * `node --test`. Localization is deferred: `buildLeadFieldViews` /
 * `describeEventKey` produce locale-free descriptors; `localizeFieldView` /
 * `resolveTimelineEntry` turn them into localized strings at the render layer.
 */

import {
  CORE_LEAD_FIELD_KEYS,
  getLeadFieldValue,
  isCoreLeadField,
  type LeadData,
} from "../../types/chat.ts";
import type { LeadFieldDefinition, LeadFieldType } from "../config/types.ts";
import type { Locale } from "../../i18n/config.ts";
import { formatDate, formatNumber } from "../../i18n/format.ts";
import type { TranslateFn, TranslateOptionalFn } from "../../i18n/translate.ts";

export type LeadFieldSource = "core" | "field" | "extra";

export interface LeadFieldView {
  key: string;
  /** Fallback label (template `label` or a humanized key). */
  label: string;
  /** Dotted dictionary key for a localized label, when the template supplies one. */
  labelKey?: string;
  /** Raw value (may be `null`). */
  value: unknown;
  type?: LeadFieldType;
  /** For a `select` value that matches an option: its localized-label key. */
  optionLabelKey?: string;
  /** For a `select` value that matches an option: its fallback label. */
  optionLabel?: string;
  /** English fallback display. `"—"` when empty. */
  display: string;
  source: LeadFieldSource;
}

const CORE_LABELS: Record<string, string> = {
  name: "Name",
  phone: "Phone",
  email: "Email",
  intent: "Intent",
};

const CORE_LABEL_KEYS: Record<string, string> = {
  name: "fields.name",
  phone: "fields.phone",
  email: "fields.email",
  intent: "fields.intent",
};

/** "appointment_date" → "Appointment date"; "propertyType" → "Property type". */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function formatFieldValue(value: unknown, type?: LeadFieldType): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toLocaleString("en-US") : "—";
  }
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.length ? value.map((v) => formatFieldValue(v)).join(", ") : "—";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "—";
    }
  }
  void type;
  return String(value);
}

function inferType(value: unknown): LeadFieldType {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "text";
}

function matchOption(def: LeadFieldDefinition, value: unknown) {
  if (def.type !== "select" || !def.options || typeof value !== "string") {
    return undefined;
  }
  return def.options.find((o) => o.value === value);
}

/**
 * Build the ordered field list for a lead detail view.
 *
 * @param lead        the generic {@link LeadData}
 * @param fieldDefs   `EffectiveConfig.leadFields` (enabled, in order)
 * @param opts.includeEmptyCore  keep core fields with no value (default `true`)
 */
export function buildLeadFieldViews(
  lead: LeadData,
  fieldDefs: readonly LeadFieldDefinition[] = [],
  opts: { includeEmptyCore?: boolean } = {},
): LeadFieldView[] {
  const includeEmptyCore = opts.includeEmptyCore ?? true;
  const views: LeadFieldView[] = [];
  const seen = new Set<string>();
  const defsByKey = new Map(fieldDefs.map((d) => [d.key, d]));

  // 1. Core fields, always in canonical order.
  for (const key of CORE_LEAD_FIELD_KEYS) {
    const value = getLeadFieldValue(lead, key);
    seen.add(key);
    if (value === null && !includeEmptyCore) continue;
    const def = defsByKey.get(key);
    const option = def ? matchOption(def, value) : undefined;
    views.push({
      key,
      label: CORE_LABELS[key] ?? humanizeKey(key),
      labelKey: CORE_LABEL_KEYS[key],
      value,
      type: def?.type ?? "text",
      optionLabelKey: option?.labelKey,
      optionLabel: option?.label,
      display: formatFieldValue(value),
      source: "core",
    });
  }

  // 2. Template fields that have a value (skip core — already shown).
  for (const def of fieldDefs) {
    if (isCoreLeadField(def.key) || seen.has(def.key)) continue;
    seen.add(def.key);
    const value = getLeadFieldValue(lead, def.key);
    if (value === null) continue;
    const option = matchOption(def, value);
    views.push({
      key: def.key,
      label: def.label || humanizeKey(def.key),
      labelKey: def.labelKey,
      value,
      type: def.type,
      optionLabelKey: option?.labelKey,
      optionLabel: option?.label,
      display: formatFieldValue(value, def.type),
      source: "field",
    });
  }

  // 3. Anything left in custom_data the template doesn't define.
  const custom = lead.customData ?? {};
  for (const key of Object.keys(custom)) {
    if (seen.has(key)) continue;
    const value = custom[key];
    if (value === null || value === undefined || value === "") continue;
    views.push({
      key,
      label: humanizeKey(key),
      value,
      type: inferType(value),
      display: formatFieldValue(value, inferType(value)),
      source: "extra",
    });
  }

  return views;
}

/**
 * Localize one {@link LeadFieldView}: label from the dictionary (falling back to
 * `label`), value formatted for `locale` with `yes` / `no` / `—` / select-option
 * labels translated. Unknown `custom_data` keys keep their humanized label.
 */
export function localizeFieldView(
  view: LeadFieldView,
  ctx: { t: TranslateFn; tOptional: TranslateOptionalFn; locale: Locale },
): { label: string; display: string } {
  const label =
    (view.labelKey ? ctx.tOptional(view.labelKey) : undefined) ?? view.label;

  let display: string;
  const value = view.value;
  if (value === null || value === undefined || value === "") {
    display = ctx.t("common.emptyValue");
  } else if (typeof value === "boolean") {
    display = ctx.t(value ? "common.yes" : "common.no");
  } else if (typeof value === "number") {
    display = formatNumber(value, ctx.locale);
  } else if (typeof value === "string" && (view.optionLabelKey || view.optionLabel)) {
    display =
      (view.optionLabelKey ? ctx.tOptional(view.optionLabelKey) : undefined) ??
      view.optionLabel ??
      value;
  } else {
    display = view.display;
  }

  return { label, display };
}

// ── timeline ───────────────────────────────────────────────────────────────

export interface LeadEventLike {
  event_type: string;
  metadata: unknown;
  created_at: string;
}

export type TimelineDetail =
  | { kind: "text"; text: string }
  | { kind: "i18n"; key: string; params?: Record<string, string | number> }
  | { kind: "i18nDate"; key: string; iso: string }
  | { kind: "statusTransition"; from: string; to: string }
  | { kind: "temperatureTransition"; from: string; to: string }
  | { kind: "dateTransition"; from: string; to: string }
  | { kind: "leadCreated"; score: string; temperature: string }
  | null;

export interface TimelineDescriptor {
  at: string;
  /** Dictionary key for the title, or `null` when `titleText` should be used. */
  titleKey: string | null;
  /** Literal title for unknown event types (humanized). */
  titleText?: string;
  detail: TimelineDetail;
}

export interface TimelineEntry {
  at: string;
  title: string;
  detail: string | null;
}

function meta(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return value === undefined || value === null ? "—" : String(value);
}

/** Locale-free descriptor for a `lead_events` row. Generic — no English copy. */
export function describeEventKey(event: LeadEventLike): TimelineDescriptor {
  const m = meta(event.metadata);
  const at = event.created_at;

  switch (event.event_type) {
    case "lead_created":
      return {
        at,
        titleKey: "events.leadCreated",
        detail:
          m.score !== undefined
            ? {
                kind: "leadCreated",
                score: str(m.score),
                temperature: str(m.temperature),
              }
            : null,
      };
    case "message_received":
      return {
        at,
        titleKey: "events.messageReceived",
        detail:
          typeof m.preview === "string" ? { kind: "text", text: m.preview } : null,
      };
    case "score_changed":
      return {
        at,
        titleKey: "events.scoreChanged",
        detail: {
          kind: "i18n",
          key: "events.transition",
          params: { from: str(m.from), to: str(m.to) },
        },
      };
    case "temperature_changed":
      return {
        at,
        titleKey: "events.temperatureChanged",
        detail: { kind: "temperatureTransition", from: str(m.from), to: str(m.to) },
      };
    case "status_changed":
      return {
        at,
        titleKey: "events.statusChanged",
        detail: { kind: "statusTransition", from: str(m.from), to: str(m.to) },
      };
    case "lead_qualified":
      return {
        at,
        titleKey: "events.leadQualified",
        detail: {
          kind: "i18n",
          key:
            m.source === "chat"
              ? "events.leadQualifiedAuto"
              : "events.leadQualifiedManual",
        },
      };
    case "follow_up_created":
      return {
        at,
        titleKey: "events.followUpCreated",
        detail:
          typeof m.scheduledAt === "string"
            ? { kind: "i18nDate", key: "events.followUpCreatedDetail", iso: m.scheduledAt }
            : null,
      };
    case "follow_up_completed":
      return { at, titleKey: "events.followUpCompleted", detail: null };
    case "follow_up_cancelled":
      return { at, titleKey: "events.followUpCancelled", detail: null };
    case "follow_up_executed": {
      const channel = typeof m.channel === "string" ? m.channel : null;
      const attempt = Number(m.attempt);
      if (!channel) {
        return { at, titleKey: "events.followUpExecuted", detail: null };
      }
      return {
        at,
        titleKey: "events.followUpExecuted",
        detail:
          attempt > 1
            ? {
                kind: "i18n",
                key: "events.followUpExecutedAttempt",
                params: { channel, attempt },
              }
            : {
                kind: "i18n",
                key: "events.followUpExecutedDetail",
                params: { channel },
              },
      };
    }
    case "follow_up_retry_scheduled":
      return {
        at,
        titleKey: "events.followUpRetryScheduled",
        detail:
          typeof m.nextAttemptAt === "string"
            ? { kind: "i18nDate", key: "events.followUpRetryDetail", iso: m.nextAttemptAt }
            : null,
      };
    case "follow_up_failed":
      return {
        at,
        titleKey: "events.followUpFailed",
        detail: typeof m.error === "string" ? { kind: "text", text: m.error } : null,
      };
    case "human_handoff_requested":
      return {
        at,
        titleKey: "events.humanHandoffRequested",
        detail: typeof m.reason === "string" ? { kind: "text", text: m.reason } : null,
      };
    case "recovery_attempt_started":
      return { at, titleKey: "events.recoveryAttemptStarted", detail: null };
    case "appointment_booked":
      return {
        at,
        titleKey: "events.appointmentBooked",
        detail:
          typeof m.startsAt === "string"
            ? { kind: "i18nDate", key: "events.appointmentBookedDetail", iso: m.startsAt }
            : null,
      };
    case "appointment_rescheduled":
      return {
        at,
        titleKey: "events.appointmentRescheduled",
        detail:
          typeof m.from === "string" && typeof m.to === "string"
            ? { kind: "dateTransition", from: m.from, to: m.to }
            : null,
      };
    case "appointment_cancelled":
      return {
        at,
        titleKey: "events.appointmentCancelled",
        detail: typeof m.reason === "string" ? { kind: "text", text: m.reason } : null,
      };
    case "appointment_completed":
      return { at, titleKey: "events.appointmentCompleted", detail: null };
    case "appointment_no_show":
      return { at, titleKey: "events.appointmentNoShow", detail: null };
    default:
      return {
        at,
        titleKey: null,
        titleText: humanizeKey(event.event_type),
        detail: null,
      };
  }
}

/** Resolve a {@link TimelineDescriptor} into localized `{ title, detail }`. */
export function resolveTimelineEntry(
  d: TimelineDescriptor,
  ctx: { t: TranslateFn; tOptional: TranslateOptionalFn; locale: Locale },
): TimelineEntry {
  const { t, tOptional, locale } = ctx;
  const title = d.titleKey ? t(d.titleKey) : (d.titleText ?? "");

  let detail: string | null = null;
  const dt = d.detail;
  if (dt) {
    switch (dt.kind) {
      case "text":
        detail = dt.text;
        break;
      case "i18n":
        detail = t(dt.key, dt.params);
        break;
      case "i18nDate":
        detail = t(dt.key, { date: formatDate(dt.iso, locale) });
        break;
      case "statusTransition":
        detail = t("events.transition", {
          from: tOptional(`statuses.${dt.from}`) ?? humanizeKey(dt.from),
          to: tOptional(`statuses.${dt.to}`) ?? humanizeKey(dt.to),
        });
        break;
      case "temperatureTransition":
        detail = t("events.transition", {
          from: tOptional(`temperatures.${dt.from.toLowerCase()}`) ?? dt.from,
          to: tOptional(`temperatures.${dt.to.toLowerCase()}`) ?? dt.to,
        });
        break;
      case "leadCreated":
        detail = t("events.leadCreatedDetail", {
          score: dt.score,
          temperature:
            tOptional(`temperatures.${dt.temperature.toLowerCase()}`) ??
            dt.temperature,
        });
        break;
      case "dateTransition":
        detail = t("events.transition", {
          from: formatDate(dt.from, locale),
          to: formatDate(dt.to, locale),
        });
        break;
    }
  }

  return { at: d.at, title, detail };
}

/**
 * Back-compat English resolver used where no locale context is available (and
 * by the existing test). Prefer {@link describeEventKey} + {@link resolveTimelineEntry}.
 */
export function describeEvent(event: LeadEventLike): TimelineEntry {
  const descriptor = describeEventKey(event);
  return resolveEnglish(descriptor);
}

function resolveEnglish(d: TimelineDescriptor): TimelineEntry {
  const EN: Record<string, string> = {
    "events.leadCreated": "Lead created",
    "events.messageReceived": "Message received",
    "events.scoreChanged": "Score changed",
    "events.temperatureChanged": "Temperature changed",
    "events.statusChanged": "Status changed",
    "events.leadQualified": "Lead qualified",
    "events.leadQualifiedAuto": "Automatically — qualification complete",
    "events.leadQualifiedManual": "Marked qualified",
    "events.followUpCreated": "Follow-up scheduled",
    "events.followUpCompleted": "Follow-up completed",
    "events.followUpCancelled": "Follow-up cancelled",
    "events.followUpExecuted": "Follow-up sent",
    "events.followUpRetryScheduled": "Follow-up retry scheduled",
    "events.followUpFailed": "Follow-up failed",
    "events.humanHandoffRequested": "Human handoff requested",
    "events.recoveryAttemptStarted": "Recovery attempt started",
    "events.appointmentBooked": "Appointment booked",
    "events.appointmentRescheduled": "Appointment rescheduled",
    "events.appointmentCancelled": "Appointment cancelled",
    "events.appointmentCompleted": "Appointment completed",
    "events.appointmentNoShow": "Appointment marked no-show",
  };
  const title = d.titleKey ? (EN[d.titleKey] ?? d.titleKey) : (d.titleText ?? "");

  let detail: string | null = null;
  const dt = d.detail;
  if (dt) {
    switch (dt.kind) {
      case "text":
        detail = dt.text;
        break;
      case "i18n":
        if (dt.key === "events.transition") {
          detail = `${dt.params?.from ?? "—"} → ${dt.params?.to ?? "—"}`;
        } else if (dt.key === "events.followUpExecutedDetail") {
          detail = `via ${dt.params?.channel}`;
        } else if (dt.key === "events.followUpExecutedAttempt") {
          detail = `via ${dt.params?.channel} (attempt ${dt.params?.attempt})`;
        } else {
          detail = EN[dt.key] ?? dt.key;
        }
        break;
      case "i18nDate":
        if (dt.key === "events.followUpRetryDetail") detail = `Next attempt ${dt.iso}`;
        else if (dt.key === "events.appointmentBookedDetail") detail = dt.iso;
        else detail = `Due ${dt.iso}`;
        break;
      case "statusTransition":
        detail = `${humanizeKey(dt.from)} → ${humanizeKey(dt.to)}`;
        break;
      case "temperatureTransition":
        detail = `${dt.from.toUpperCase()} → ${dt.to.toUpperCase()}`;
        break;
      case "leadCreated":
        detail = `Initial score ${dt.score} · ${dt.temperature.toUpperCase() || "—"}`;
        break;
      case "dateTransition":
        detail = `${dt.from} → ${dt.to}`;
        break;
    }
  }

  return { at: d.at, title, detail };
}
