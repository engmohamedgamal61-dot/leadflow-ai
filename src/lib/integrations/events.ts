/**
 * The canonical LeadFlow domain events an integration endpoint can subscribe
 * to. Pure — no imports, no I/O.
 *
 * These names are a stable public contract (webhook consumers switch on
 * `type`), decoupled from the internal `lead_events.event_type` strings. The
 * DB trigger in `20260907120000_integration_hub.sql` maps internal → canonical;
 * this module is the app-side allowlist and grouping for the UI.
 */

export const INTEGRATION_EVENT_TYPES = [
  "lead.created",
  "lead.qualified",
  "lead.status_changed",
  "appointment.booked",
  "appointment.rescheduled",
  "appointment.cancelled",
  "follow_up.executed",
  "handoff.requested",
  "recovery.started",
  "recovery.resolved",
] as const;

export type IntegrationEventType = (typeof INTEGRATION_EVENT_TYPES)[number];

const EVENT_SET: ReadonlySet<string> = new Set(INTEGRATION_EVENT_TYPES);

export function isIntegrationEventType(v: unknown): v is IntegrationEventType {
  return typeof v === "string" && EVENT_SET.has(v);
}

/**
 * Groups for the subscription checklist UI. `labelKey` / `descriptionKey` are
 * dotted dictionary keys under `integrationHub.events.*`.
 */
export const INTEGRATION_EVENT_GROUPS: {
  key: string;
  events: IntegrationEventType[];
}[] = [
  { key: "lead", events: ["lead.created", "lead.qualified", "lead.status_changed"] },
  {
    key: "appointment",
    events: ["appointment.booked", "appointment.rescheduled", "appointment.cancelled"],
  },
  { key: "engagement", events: ["follow_up.executed", "handoff.requested"] },
  { key: "recovery", events: ["recovery.started", "recovery.resolved"] },
];

/**
 * Normalise a raw list of event names to a de-duplicated, sorted array of
 * known event types. Unknown entries are dropped (not an error — forward
 * compatible). Order is canonical so it stores/compares stably.
 */
export function parseSubscribedEvents(raw: unknown): IntegrationEventType[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<IntegrationEventType>();
  for (const item of list) {
    if (isIntegrationEventType(item)) seen.add(item);
  }
  return INTEGRATION_EVENT_TYPES.filter((e) => seen.has(e));
}
