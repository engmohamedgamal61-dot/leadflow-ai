/**
 * Lead event derivation.
 *
 * `lead_events` is a generic append-only history. This phase emits
 * `lead_created`, `message_received`, `score_changed`, `temperature_changed`
 * and `status_changed`; future features (`lead_qualified`, `followup_sent`,
 * `appointment_booked`, …) use the same table and the same shape.
 *
 * Pure — no I/O.
 */

export interface PendingLeadEvent {
  event_type: string;
  metadata: Record<string, unknown>;
}

/** A lead's scored state, in the database representation. */
export interface LeadSnapshot {
  score: number;
  /** "hot" | "warm" | "cold" */
  temperature: string;
  status: string;
}

export interface ComputeLeadEventsArgs {
  isNewLead: boolean;
  /** The lead's state before this turn, or `null` for a brand-new lead. */
  previous: LeadSnapshot | null;
  /** The lead's state after this turn. */
  next: LeadSnapshot;
  /** The user message that triggered this turn. */
  userMessage: string;
}

const PREVIEW_LENGTH = 160;

export function computeLeadEvents(
  args: ComputeLeadEventsArgs,
): PendingLeadEvent[] {
  const { isNewLead, previous, next, userMessage } = args;
  const events: PendingLeadEvent[] = [];

  if (isNewLead) {
    events.push({
      event_type: "lead_created",
      metadata: { score: next.score, temperature: next.temperature },
    });
  }

  events.push({
    event_type: "message_received",
    metadata: {
      role: "user",
      length: userMessage.length,
      preview: userMessage.slice(0, PREVIEW_LENGTH),
    },
  });

  if (previous) {
    if (previous.score !== next.score) {
      events.push({
        event_type: "score_changed",
        metadata: { from: previous.score, to: next.score },
      });
    }
    if (previous.temperature !== next.temperature) {
      events.push({
        event_type: "temperature_changed",
        metadata: { from: previous.temperature, to: next.temperature },
      });
    }
    if (previous.status !== next.status) {
      events.push({
        event_type: "status_changed",
        metadata: { from: previous.status, to: next.status },
      });
    }
  }

  return events;
}
