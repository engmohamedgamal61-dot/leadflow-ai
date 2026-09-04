/**
 * Next Best Action + lost-lead detection — a deterministic rules engine.
 *
 * Pure and industry-agnostic: it only ever looks at lifecycle status,
 * score/temperature, message/follow-up/appointment timestamps, and handoff
 * state — never an industry, template, or custom field. Real Estate and
 * Clinic leads run through the exact same rules.
 *
 * Claude is never consulted here and never will be by default: every
 * recommendation is derived from already-persisted data, so it costs no
 * extra Anthropic call and is trivially unit-testable.
 *
 * Rules are evaluated in order; the first match wins. Reordering a rule
 * changes behavior — see the inline comments for why each sits where it does.
 */

export const NEXT_BEST_ACTIONS = [
  "call_now",
  "follow_up",
  "reply_now",
  "book_appointment",
  "human_handoff",
  "recover_lead",
  "none",
] as const;
export type NextBestAction = (typeof NEXT_BEST_ACTIONS)[number];

export const RISK_LEVELS = ["needs_attention", "at_risk", "none"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** App-level temperature, matching `LeadRecord.temperature` (mappers.ts). */
export type InsightTemperature = "HOT" | "WARM" | "COLD";

/**
 * Everything the engine needs about one lead. Assembled by the query layer
 * (`queries.ts`) from `leads` + `messages` + `lead_follow_ups` + `appointments`
 * + `lead_events` — the engine itself never touches the database.
 */
export interface LeadInsightSignals {
  status: string;
  temperature: InsightTemperature;
  createdAt: string;
  /** Bumped whenever the lead's own row changes (score/status/etc.) — a proxy for "something happened". */
  updatedAt: string;
  /** Most recent message from the lead, across every conversation. */
  lastInboundAt: string | null;
  /** Most recent message from the assistant/agent, across every conversation. */
  lastOutboundAt: string | null;
  /** The single most recent message overall is from the lead (nobody has replied since). */
  lastMessageIsInbound: boolean;
  /** A human handoff was requested and nothing has been sent to the lead since. */
  handoffPending: boolean;
  /** Follow-ups still `pending` (not completed/cancelled/failed). */
  pendingFollowUps: readonly { scheduledAt: string }[];
  /** The lead's one active (`scheduled` or `rescheduled`) appointment, if any. */
  activeAppointment: { startsAt: string } | null;
  /** The most recently cancelled appointment, if any — for recovery detection. */
  lastCancelledAppointment: { updatedAt: string } | null;
}

export interface LeadInsight {
  riskLevel: RiskLevel;
  action: NextBestAction;
  /** Dotted `insights.reasons.*` dictionary key. */
  reasonKey: string;
  /** Interpolation params for `reasonKey`. */
  reasonParams?: Record<string, string | number>;
}

/** Lifecycle stages past which no further action is ever recommended. */
const CLOSED_STATUSES = new Set(["won", "lost", "archived"]);
const ACTIVE_APPOINTMENT_LOOKING_FORWARD_MS = 0;

/** A lead who just messaged and got no reply within this window needs a reply now. */
export const UNANSWERED_INBOUND_MINUTES = 30;
/** A hot lead with no activity in this many hours risks going cold. */
export const HOT_STALE_HOURS = 24;
/** A qualified lead with nothing scheduled, inactive this many days, should be booked. */
export const INACTIVE_QUALIFIED_DAYS = 3;
/** A cancelled appointment is worth actively recovering within this many days. */
export const APPOINTMENT_RECOVERY_DAYS = 7;

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function hoursBetween(fromIso: string | null, now: Date): number | null {
  const t = parseTime(fromIso);
  return t === null ? null : (now.getTime() - t) / 3_600_000;
}

/** Deterministic Next Best Action + risk level for one lead. No I/O, no AI. */
export function computeLeadInsight(
  signals: LeadInsightSignals,
  now: Date = new Date(),
): LeadInsight {
  // 0. Closed lifecycle — nothing left to do, regardless of any other signal.
  if (CLOSED_STATUSES.has(signals.status)) {
    return { riskLevel: "none", action: "none", reasonKey: "insights.reasons.closed" };
  }

  // 1. The lead messaged and nobody has replied yet. Most urgent — a quiet
  // hot lead is a risk, but a customer waiting on a reply right now is worse.
  if (signals.lastMessageIsInbound) {
    const inboundMinutes = hoursBetween(signals.lastInboundAt, now);
    if (inboundMinutes !== null && inboundMinutes * 60 >= UNANSWERED_INBOUND_MINUTES) {
      return {
        riskLevel: "needs_attention",
        action: "reply_now",
        reasonKey: "insights.reasons.unansweredInbound",
        reasonParams: { minutes: Math.round(inboundMinutes * 60) },
      };
    }
  }

  // 2. A human was explicitly asked for and hasn't been given one yet.
  if (signals.handoffPending) {
    return {
      riskLevel: "needs_attention",
      action: "human_handoff",
      reasonKey: "insights.reasons.handoffPending",
    };
  }

  // 3. A follow-up that should already have happened.
  const overdue = [...signals.pendingFollowUps]
    .filter((f) => (parseTime(f.scheduledAt) ?? Infinity) < now.getTime())
    .sort((a, b) => (parseTime(a.scheduledAt) ?? 0) - (parseTime(b.scheduledAt) ?? 0))[0];
  if (overdue) {
    const overdueDays = Math.max(
      1,
      Math.round(((now.getTime() - (parseTime(overdue.scheduledAt) ?? now.getTime())) / 86_400_000)),
    );
    return {
      riskLevel: "needs_attention",
      action: "follow_up",
      reasonKey: "insights.reasons.followUpOverdue",
      reasonParams: { days: overdueDays },
    };
  }

  // 4. An appointment is booked but its time has already passed — it was
  // missed (nothing in this product auto-marks appointments completed).
  const activeStart = parseTime(signals.activeAppointment?.startsAt ?? null);
  if (activeStart !== null && activeStart < now.getTime() - ACTIVE_APPOINTMENT_LOOKING_FORWARD_MS) {
    return {
      riskLevel: "at_risk",
      action: "recover_lead",
      reasonKey: "insights.reasons.appointmentMissed",
    };
  }

  // 5. A real, still-upcoming appointment exists — the lead is on track;
  // being otherwise quiet is expected, not a risk. Checked before the
  // hot/stale and cancelled-appointment rules so it takes precedence.
  if (activeStart !== null) {
    return { riskLevel: "none", action: "none", reasonKey: "insights.reasons.appointmentUpcoming" };
  }

  // 6. A future follow-up is already scheduled — also on track.
  const hasFutureFollowUp = signals.pendingFollowUps.some(
    (f) => (parseTime(f.scheduledAt) ?? 0) >= now.getTime(),
  );
  if (hasFutureFollowUp) {
    return { riskLevel: "none", action: "none", reasonKey: "insights.reasons.followUpScheduled" };
  }

  // 7. An appointment was cancelled recently and nothing replaced it.
  if (signals.lastCancelledAppointment) {
    const cancelledDaysAgo = hoursBetween(signals.lastCancelledAppointment.updatedAt, now);
    if (cancelledDaysAgo !== null && cancelledDaysAgo / 24 <= APPOINTMENT_RECOVERY_DAYS) {
      return {
        riskLevel: "at_risk",
        action: "recover_lead",
        reasonKey: "insights.reasons.appointmentCancelled",
        reasonParams: { days: Math.max(1, Math.round(cancelledDaysAgo / 24)) },
      };
    }
  }

  // 8. A hot lead that has gone quiet is the clearest "about to lose it" signal.
  const activitySources = [signals.lastInboundAt, signals.lastOutboundAt, signals.updatedAt]
    .map((iso) => parseTime(iso))
    .filter((t): t is number => t !== null);
  const lastActivityAt =
    activitySources.length > 0 ? Math.max(...activitySources) : parseTime(signals.createdAt) ?? now.getTime();
  const hoursSinceActivity = (now.getTime() - lastActivityAt) / 3_600_000;

  if (signals.temperature === "HOT" && hoursSinceActivity >= HOT_STALE_HOURS) {
    return {
      riskLevel: "at_risk",
      action: "call_now",
      reasonKey: "insights.reasons.hotLeadStale",
      reasonParams: { hours: Math.round(hoursSinceActivity) },
    };
  }

  // 9. Qualified, nothing planned, and inactive for a while — ready to book.
  if (signals.status === "qualified" && hoursSinceActivity >= INACTIVE_QUALIFIED_DAYS * 24) {
    return {
      riskLevel: "at_risk",
      action: "book_appointment",
      reasonKey: "insights.reasons.qualifiedInactive",
      reasonParams: { days: Math.round(hoursSinceActivity / 24) },
    };
  }

  // 10. Nothing else applies — the lead is progressing normally.
  return { riskLevel: "none", action: "none", reasonKey: "insights.reasons.onTrack" };
}

// ── building signals from persisted data ────────────────────────────────────
//
// These accept structurally-compatible shapes (not `queries.ts`'s exact
// types) so this module stays import-free and runs under `node --test` —
// same pattern as `LeadEventLike` in `lead-view.ts`. `LeadDetail`'s
// `record`/`messages`/`events`/`followUps`/`appointments` already satisfy
// these shapes; callers pass them straight through.

export interface InsightLeadLike {
  status: string;
  temperature: InsightTemperature;
  createdAt: string;
  updatedAt: string;
}

export interface InsightMessageLike {
  role: string;
  createdAt: string;
}

export interface InsightEventLike {
  eventType: string;
  createdAt: string;
}

export interface InsightFollowUpLike {
  status: string;
  scheduledAt: string;
}

export interface InsightAppointmentLike {
  status: string;
  startsAt: string;
  updatedAt: string;
}

/**
 * Build the engine's input from one lead's full, already-loaded detail
 * (messages/events/appointments ascending by time, as `getLeadDetail`
 * returns them) — no extra queries, no I/O.
 */
export function buildInsightSignals(input: {
  lead: InsightLeadLike;
  messages: readonly InsightMessageLike[];
  events: readonly InsightEventLike[];
  followUps: readonly InsightFollowUpLike[];
  appointments: readonly InsightAppointmentLike[];
}): LeadInsightSignals {
  const { lead, messages, events, followUps, appointments } = input;

  const lastInbound = [...messages].reverse().find((m) => m.role === "user");
  const lastOutbound = [...messages].reverse().find((m) => m.role === "assistant");
  const lastMessage = messages[messages.length - 1];

  const lastHandoff = [...events].reverse().find((e) => e.eventType === "human_handoff_requested");
  const handoffPending =
    lastHandoff !== undefined &&
    (!lastOutbound || Date.parse(lastHandoff.createdAt) > Date.parse(lastOutbound.createdAt));

  const activeAppointment = appointments.find(
    (a) => a.status === "scheduled" || a.status === "rescheduled",
  );
  const lastCancelledAppointment = [...appointments]
    .filter((a) => a.status === "cancelled")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];

  return {
    status: lead.status,
    temperature: lead.temperature,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    lastInboundAt: lastInbound?.createdAt ?? null,
    lastOutboundAt: lastOutbound?.createdAt ?? null,
    lastMessageIsInbound: lastMessage?.role === "user",
    handoffPending,
    pendingFollowUps: followUps
      .filter((f) => f.status === "pending")
      .map((f) => ({ scheduledAt: f.scheduledAt })),
    activeAppointment: activeAppointment ? { startsAt: activeAppointment.startsAt } : null,
    lastCancelledAppointment: lastCancelledAppointment
      ? { updatedAt: lastCancelledAppointment.updatedAt }
      : null,
  };
}
