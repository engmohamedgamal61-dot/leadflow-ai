/**
 * Generic AI agent actions — the typed, validated, industry-agnostic registry.
 *
 * Claude never touches the database. The model proposes structured actions from
 * an **allowlist** (`AI_PROPOSABLE_ACTION_TYPES`); this module parses and
 * validates that proposal, and `executor.ts` (server) is the only thing that
 * runs it. Unknown action types and malformed payloads are dropped here.
 *
 * Pure — no imports, no I/O.
 */

/** Every action the executor knows how to run. */
export const AGENT_ACTION_TYPES = [
  "update_lead_status",
  "create_follow_up",
  "request_human_handoff",
  "mark_qualified",
  "book_appointment",
  "reschedule_appointment",
  "cancel_appointment",
] as const;
export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number];

/**
 * The subset Claude may propose. `mark_qualified` is server-deterministic and
 * `update_lead_status` is dashboard-only — the model can't drive either.
 * `book_appointment` / `reschedule_appointment` only ever carry a timestamp
 * the model was shown as real, available slots — `calendar/service.ts`
 * re-validates it against live provider availability before touching
 * anything, so the model proposing a slot is never enough on its own.
 */
export const AI_PROPOSABLE_ACTION_TYPES = [
  "create_follow_up",
  "request_human_handoff",
  "book_appointment",
  "reschedule_appointment",
  "cancel_appointment",
] as const;
export type AiProposableActionType =
  (typeof AI_PROPOSABLE_ACTION_TYPES)[number];

function isProposableType(v: string): v is AiProposableActionType {
  return (AI_PROPOSABLE_ACTION_TYPES as readonly string[]).includes(v);
}

/** Hard cap on actions considered from one turn. */
export const MAX_ACTIONS_PER_TURN = 3;
const REASON_MAX = 200;
const NOTE_MAX = 500;
/** A follow-up must be scheduled within this window. */
export const FOLLOW_UP_MAX_DAYS = 365;
/**
 * An appointment slot must be within this window — a generic sanity bound.
 * The real ceiling is the organization's configured lookahead
 * (`calendar/config.ts` `LIMITS.maxLookaheadDays` = 60), re-checked against
 * live availability in `calendar/service.ts`.
 */
export const APPOINTMENT_MAX_DAYS = 60;

export type ProposedAction =
  | { type: "create_follow_up"; scheduledAt: string; reason: string | null }
  | { type: "request_human_handoff"; reason: string | null }
  | { type: "book_appointment"; startsAt: string; reason: string | null }
  | { type: "reschedule_appointment"; startsAt: string; reason: string | null }
  | { type: "cancel_appointment"; reason: string | null };

export interface ParseActionsResult {
  actions: ProposedAction[];
  /** Human-readable reasons a proposed item was dropped (for server logs). */
  rejected: string[];
}

function trimCap(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

export interface TimestampResult {
  ok: boolean;
  iso?: string;
  /** Human-readable reason for server logs / AI rejection notes. */
  error?: string;
  /** Dotted `errors.leads.*` dictionary key for the dashboard form. */
  errorCode?: "dateMissing" | "dateUnparseable" | "datePast" | "dateTooFarOut";
  /** Populated with `errorCode === "dateTooFarOut"`. */
  maxDays?: number;
}

/**
 * Validate an AI-supplied timestamp: parseable, strictly in the future, and no
 * more than {@link FOLLOW_UP_MAX_DAYS} out. A bare datetime (no timezone) is
 * read as UTC. Returns a normalized ISO string.
 */
export function validateFutureTimestamp(
  raw: unknown,
  now: Date = new Date(),
  maxDays: number = FOLLOW_UP_MAX_DAYS,
): TimestampResult {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, error: "missing timestamp", errorCode: "dateMissing" };
  }
  let value = raw.trim();
  // "YYYY-MM-DDTHH:MM(:SS)" with no zone → treat as UTC.
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    value = value.replace(" ", "T") + "Z";
  }
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) {
    return { ok: false, error: "unparseable timestamp", errorCode: "dateUnparseable" };
  }

  const nowMs = now.getTime();
  if (ts <= nowMs) {
    return { ok: false, error: "timestamp is in the past", errorCode: "datePast" };
  }
  if (ts - nowMs > maxDays * 86_400_000) {
    return {
      ok: false,
      error: `timestamp is more than ${maxDays} days out`,
      errorCode: "dateTooFarOut",
      maxDays,
    };
  }
  return { ok: true, iso: new Date(ts).toISOString() };
}

/**
 * Parse the `proposed_actions` array from Claude's structured output into a
 * validated `ProposedAction[]`. Anything not on the allowlist, or with an
 * invalid payload, is dropped (and noted in `rejected`).
 */
export function parseProposedActions(
  raw: unknown,
  now: Date = new Date(),
): ParseActionsResult {
  const rejected: string[] = [];
  if (!Array.isArray(raw)) return { actions: [], rejected };

  const actions: ProposedAction[] = [];
  const seen = new Set<string>();

  for (const item of raw.slice(0, MAX_ACTIONS_PER_TURN * 2)) {
    if (actions.length >= MAX_ACTIONS_PER_TURN) break;
    if (!item || typeof item !== "object") {
      rejected.push("not an object");
      continue;
    }
    const rawType = (item as { type?: unknown }).type;
    if (typeof rawType !== "string") {
      rejected.push("missing action type");
      continue;
    }
    if (!isProposableType(rawType)) {
      rejected.push(`unknown or non-proposable action "${rawType}"`);
      continue;
    }
    const type: AiProposableActionType = rawType;
    if (seen.has(type)) {
      rejected.push(`duplicate action "${type}" in one turn`);
      continue;
    }

    const reason = trimCap((item as { reason?: unknown }).reason, REASON_MAX);

    if (type === "request_human_handoff" || type === "cancel_appointment") {
      seen.add(type);
      actions.push({ type, reason });
      continue;
    }

    if (type === "create_follow_up") {
      const when = validateFutureTimestamp(
        (item as { scheduled_at?: unknown }).scheduled_at,
        now,
      );
      if (!when.ok) {
        rejected.push(`create_follow_up rejected: ${when.error}`);
        continue;
      }
      seen.add(type);
      actions.push({ type, scheduledAt: when.iso as string, reason });
      continue;
    }

    // book_appointment / reschedule_appointment — `startsAt` must be one of
    // the real slots the model was shown; `calendar/service.ts` re-validates
    // it against live availability regardless.
    const when = validateFutureTimestamp(
      (item as { scheduled_at?: unknown }).scheduled_at,
      now,
      APPOINTMENT_MAX_DAYS,
    );
    if (!when.ok) {
      rejected.push(`${type} rejected: ${when.error}`);
      continue;
    }
    seen.add(type);
    actions.push({ type, startsAt: when.iso as string, reason });
  }

  return { actions, rejected };
}

/** Clamp a note to the stored column limit. */
export function normalizeNote(value: unknown): string | null {
  return trimCap(value, NOTE_MAX);
}
