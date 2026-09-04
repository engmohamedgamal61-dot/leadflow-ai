/**
 * Generic, industry-agnostic presentation of a persisted lead.
 *
 * Real Estate, Clinic and any future industry render through this one path:
 * the core fields, then whichever template fields have a value, then any
 * leftover `custom_data` keys the template doesn't know about. No industry
 * branches, and nothing here reads a database column name.
 *
 * `getLeadFieldValue` / `isCoreLeadField` are imported by relative path so this
 * module (and its test) run under `node --test`.
 */

import {
  CORE_LEAD_FIELD_KEYS,
  getLeadFieldValue,
  isCoreLeadField,
  type LeadData,
} from "../../types/chat.ts";
import type { LeadFieldDefinition, LeadFieldType } from "@/lib/config/types";

export type LeadFieldSource = "core" | "field" | "extra";

export interface LeadFieldView {
  key: string;
  label: string;
  /** Raw value (may be `null`). */
  value: unknown;
  /** Human-readable string. `"—"` when empty. */
  display: string;
  source: LeadFieldSource;
}

const CORE_LABELS: Record<string, string> = {
  name: "Name",
  phone: "Phone",
  email: "Email",
  intent: "Intent",
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
  // `type` is accepted for future formatting (currency, localised dates); the
  // value's runtime type already covers today's needs.
  void type;
  return String(value);
}

function inferType(value: unknown): LeadFieldType {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "text";
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

  // 1. Core fields, always in canonical order.
  for (const key of CORE_LEAD_FIELD_KEYS) {
    const value = getLeadFieldValue(lead, key);
    seen.add(key);
    if (value === null && !includeEmptyCore) continue;
    views.push({
      key,
      label: CORE_LABELS[key] ?? humanizeKey(key),
      value,
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
    views.push({
      key: def.key,
      label: def.label || humanizeKey(def.key),
      value,
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
      display: formatFieldValue(value, inferType(value)),
      source: "extra",
    });
  }

  return views;
}

// ── timeline ───────────────────────────────────────────────────────────────

export interface LeadEventLike {
  event_type: string;
  metadata: unknown;
  created_at: string;
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

/** Human-readable label + detail for a `lead_events` row. Generic. */
export function describeEvent(event: LeadEventLike): TimelineEntry {
  const m = meta(event.metadata);
  switch (event.event_type) {
    case "lead_created":
      return {
        at: event.created_at,
        title: "Lead created",
        detail:
          m.score !== undefined
            ? `Initial score ${m.score} · ${String(m.temperature ?? "").toUpperCase() || "—"}`
            : null,
      };
    case "message_received":
      return {
        at: event.created_at,
        title: "Message received",
        detail: typeof m.preview === "string" ? m.preview : null,
      };
    case "score_changed":
      return {
        at: event.created_at,
        title: "Score changed",
        detail: `${m.from ?? "—"} → ${m.to ?? "—"}`,
      };
    case "temperature_changed":
      return {
        at: event.created_at,
        title: "Temperature changed",
        detail: `${String(m.from ?? "—").toUpperCase()} → ${String(m.to ?? "—").toUpperCase()}`,
      };
    case "status_changed":
      return {
        at: event.created_at,
        title: "Status changed",
        detail: `${humanizeKey(String(m.from ?? "—"))} → ${humanizeKey(String(m.to ?? "—"))}`,
      };
    case "lead_qualified":
      return {
        at: event.created_at,
        title: "Lead qualified",
        detail:
          m.source === "chat"
            ? "Automatically — qualification complete"
            : "Marked qualified",
      };
    case "follow_up_created":
      return {
        at: event.created_at,
        title: "Follow-up scheduled",
        detail:
          typeof m.scheduledAt === "string"
            ? `Due ${m.scheduledAt}`
            : null,
      };
    case "follow_up_completed":
      return { at: event.created_at, title: "Follow-up completed", detail: null };
    case "follow_up_cancelled":
      return { at: event.created_at, title: "Follow-up cancelled", detail: null };
    case "human_handoff_requested":
      return {
        at: event.created_at,
        title: "Human handoff requested",
        detail: typeof m.reason === "string" ? m.reason : null,
      };
    default:
      return {
        at: event.created_at,
        title: humanizeKey(event.event_type),
        detail: null,
      };
  }
}
