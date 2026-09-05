/**
 * Revenue Recovery — deterministic lost/inactive-lead detection.
 *
 * Pure and industry-agnostic, mirroring `insights.ts`'s shape exactly: only
 * lifecycle status, temperature, and activity timestamps ever drive a
 * decision — never an industry, template, or custom field. Real Estate and
 * Clinic leads run through the exact same rules.
 *
 * Claude is never consulted here and never will be by default — every
 * recommendation is derived from already-persisted data, so it costs no
 * extra Anthropic call and is trivially unit-testable.
 *
 * Where `insights.ts` (Phase K) flags leads that need attention RIGHT NOW
 * (hours/days), this engine flags leads that have gone quiet for much
 * longer, or were explicitly marked lost — a distinct, longer-horizon
 * "worth one more real attempt" campaign layer, not a duplicate of it.
 */

export const RECOVERY_PRIORITIES = ["high", "medium", "low"] as const;
export type RecoveryPriority = (typeof RECOVERY_PRIORITIES)[number];

export const RECOVERY_OUTCOMES = [
  "pending",
  "contacted",
  "recovered",
  "converted",
  "no_response",
] as const;
export type RecoveryOutcome = (typeof RECOVERY_OUTCOMES)[number];

/** App-level temperature, matching `LeadRecord.temperature` (mappers.ts). */
export type RecoveryTemperature = "HOT" | "WARM" | "COLD";

/** Lifecycle stages that are never recovery candidates. */
const EXCLUDED_STATUSES = new Set(["won", "archived"]);

/** A non-"lost" lead silent this many days is worth a recovery attempt. */
export const RECOVERY_INACTIVITY_DAYS = 14;
/** A COLD, never-progressed lead needs a longer silence before it's worth trying. */
export const RECOVERY_COLD_INACTIVITY_DAYS = 30;
/** After a resolved (no_response) attempt, wait this long before re-surfacing the lead. */
export const RECOVERY_REATTEMPT_COOLDOWN_DAYS = 14;
/** A contacted lead silent this many days after outreach is presumed unresponsive. */
export const RECOVERY_NO_RESPONSE_DAYS = 7;

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function daysBetween(fromIso: string | null, now: Date): number | null {
  const t = parseTime(fromIso);
  return t === null ? null : (now.getTime() - t) / 86_400_000;
}

/**
 * Everything the engine needs about one lead to decide recovery eligibility.
 * Assembled by the query layer (`queries.ts`) — the engine itself never
 * touches the database.
 */
export interface RecoverySignals {
  status: string;
  temperature: RecoveryTemperature;
  createdAt: string;
  /** Bumped whenever the lead's own row changes — a proxy for "something happened". */
  updatedAt: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  /** A follow-up (of any kind) is already pending — already being handled. */
  hasPendingFollowUp: boolean;
  /** The lead has an active (`scheduled`/`rescheduled`) appointment — not actually lost. */
  hasActiveAppointment: boolean;
  /** An unresolved recovery attempt already exists for this lead. */
  hasOpenRecoveryAttempt: boolean;
  /** When the most recent recovery attempt was resolved, if any (for the re-attempt cooldown). */
  lastRecoveryResolvedAt: string | null;
}

export interface RecoveryCandidate {
  priority: RecoveryPriority;
  /** Dotted `recovery.reasons.*` dictionary key. */
  reasonKey: string;
  /** Interpolation params for `reasonKey`. */
  reasonParams?: Record<string, string | number>;
}

/**
 * Deterministic recovery eligibility + priority + reason for one lead, or
 * `null` if it isn't a recovery candidate right now. No I/O, no AI.
 */
export function computeRecoveryCandidate(
  signals: RecoverySignals,
  now: Date = new Date(),
): RecoveryCandidate | null {
  // Converted or explicitly archived — nothing to recover, ever.
  if (EXCLUDED_STATUSES.has(signals.status)) return null;

  // A duplicate attempt is never allowed while one is still open.
  if (signals.hasOpenRecoveryAttempt) return null;

  // Just closed out (no_response) — give it a cooldown before trying again.
  const resolvedDaysAgo = daysBetween(signals.lastRecoveryResolvedAt, now);
  if (resolvedDaysAgo !== null && resolvedDaysAgo < RECOVERY_REATTEMPT_COOLDOWN_DAYS) {
    return null;
  }

  // Already being handled through the normal flow, or has something
  // scheduled — not actually lost.
  if (signals.hasPendingFollowUp) return null;
  if (signals.hasActiveAppointment) return null;

  // Explicitly marked lost: always a candidate, priority reflects how good
  // the lead looked before it was lost.
  if (signals.status === "lost") {
    return signals.temperature === "HOT"
      ? { priority: "high", reasonKey: "recovery.reasons.lostHot" }
      : { priority: "medium", reasonKey: "recovery.reasons.lostGeneral" };
  }

  // Otherwise: silently inactive for a while, never explicitly lost.
  const activitySources = [signals.lastInboundAt, signals.lastOutboundAt, signals.updatedAt]
    .map((iso) => parseTime(iso))
    .filter((t): t is number => t !== null);
  const lastActivityAt =
    activitySources.length > 0 ? Math.max(...activitySources) : parseTime(signals.createdAt) ?? now.getTime();
  const daysInactive = (now.getTime() - lastActivityAt) / 86_400_000;

  if (signals.status === "qualified" || signals.status === "appointment") {
    if (daysInactive >= RECOVERY_INACTIVITY_DAYS) {
      return {
        priority: "high",
        reasonKey: "recovery.reasons.inactiveQualified",
        reasonParams: { days: Math.round(daysInactive) },
      };
    }
    return null;
  }

  // status is "new" or "contacted".
  if (signals.temperature !== "COLD" && daysInactive >= RECOVERY_INACTIVITY_DAYS) {
    return {
      priority: "medium",
      reasonKey: "recovery.reasons.inactiveWarm",
      reasonParams: { days: Math.round(daysInactive) },
    };
  }
  if (signals.temperature === "COLD" && daysInactive >= RECOVERY_COLD_INACTIVITY_DAYS) {
    return {
      priority: "low",
      reasonKey: "recovery.reasons.inactiveCold",
      reasonParams: { days: Math.round(daysInactive) },
    };
  }
  return null;
}

/**
 * Live-derived state of one existing recovery attempt, for display. Only
 * `converted`/`no_response` are ever persisted (see
 * `lead_recovery_attempts.resolved_as`) — `pending`/`contacted`/`recovered`
 * are computed fresh every time from the linked follow-up + message history,
 * never stored, so there is nothing to keep in sync.
 */
export interface RecoveryAttemptSignals {
  leadStatus: string;
  followUpStatus: string;
  followUpCompletedAt: string | null;
  /** Most recent inbound message for this lead, across every conversation. */
  lastInboundAt: string | null;
  resolvedAs: "converted" | "no_response" | null;
}

export function computeRecoveryAttemptOutcome(
  signals: RecoveryAttemptSignals,
  now: Date = new Date(),
): RecoveryOutcome {
  if (signals.resolvedAs) return signals.resolvedAs;
  if (signals.leadStatus === "won") return "converted";

  // Delivery never happened, or was called off — this attempt didn't reach them.
  if (signals.followUpStatus === "failed" || signals.followUpStatus === "cancelled") {
    return "no_response";
  }

  if (signals.followUpStatus === "completed") {
    const inboundAfterContact =
      signals.followUpCompletedAt &&
      signals.lastInboundAt &&
      Date.parse(signals.lastInboundAt) > Date.parse(signals.followUpCompletedAt);
    if (inboundAfterContact) return "recovered";

    const daysSinceContact = daysBetween(signals.followUpCompletedAt, now);
    if (daysSinceContact !== null && daysSinceContact >= RECOVERY_NO_RESPONSE_DAYS) {
      return "no_response";
    }
    return "contacted";
  }

  return "pending";
}

// ── building signals from persisted data ────────────────────────────────────
//
// Structurally-compatible shapes (not `queries.ts`'s exact types) so this
// module stays import-free and runs under `node --test` — same pattern as
// `InsightLeadLike` in `insights.ts`.

export interface RecoveryLeadLike {
  status: string;
  temperature: RecoveryTemperature;
  createdAt: string;
  updatedAt: string;
}

/** Best channel for a recovery outreach, using only data already on the lead. */
export function resolveRecoveryChannel(lead: { phone: string | null }): "whatsapp" | "internal" {
  return lead.phone && lead.phone.trim() ? "whatsapp" : "internal";
}
