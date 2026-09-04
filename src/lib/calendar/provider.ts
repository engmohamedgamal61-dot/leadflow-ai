/**
 * Generic calendar provider abstraction.
 *
 *   AI / dashboard  →  CalendarService (service.ts)  →  CalendarProvider
 *
 * Everything above the provider boundary works with `TimeSlot` /
 * `BusyInterval` (ISO strings) — no Google-specific (or any provider-specific)
 * shape ever leaks past `google/client.ts`. Adding Outlook or Calendly later
 * is one adapter + one line in `registry.ts`; nothing else changes.
 */

export type CalendarProviderId = "google";

/** A stored connection's provider-neutral fields, as read from the DB. */
export interface CalendarConnectionRecord {
  id: string;
  organizationId: string;
  provider: CalendarProviderId;
  status: "pending" | "connected" | "disconnected" | "error";
  calendarId: string | null;
  calendarEmail: string | null;
  timezone: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: string | null;
  settings: import("./config.ts").CalendarSettings;
}

export interface TimeRange {
  /** Inclusive, ISO 8601. */
  start: string;
  /** Exclusive, ISO 8601. */
  end: string;
}

export interface BusyInterval {
  startsAt: string;
  endsAt: string;
}

export interface TimeSlot {
  startsAt: string;
  endsAt: string;
}

export interface CreateEventInput {
  summary: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
}

export interface UpdateEventInput {
  providerEventId: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
}

export interface ProviderEventResult {
  ok: boolean;
  providerEventId?: string;
  /** Short, non-sensitive — safe for `last_error` / logs. */
  errorDetail?: string;
}

/**
 * A provider adapter never sees Supabase or organization ids — only the
 * decrypted connection it's given. `service.ts` owns persistence, tenancy,
 * and the double-booking guard.
 */
export interface CalendarProvider {
  readonly id: CalendarProviderId;
  /** Refresh the access token if the provider requires it. Returns the (possibly unchanged) credentials. */
  ensureFreshToken(
    connection: CalendarConnectionRecord,
  ): Promise<{ accessToken: string; expiresAt: string | null } | null>;
  getBusyIntervals(
    connection: CalendarConnectionRecord,
    range: TimeRange,
  ): Promise<BusyInterval[]>;
  createEvent(
    connection: CalendarConnectionRecord,
    input: CreateEventInput,
  ): Promise<ProviderEventResult>;
  updateEvent(
    connection: CalendarConnectionRecord,
    input: UpdateEventInput,
  ): Promise<ProviderEventResult>;
  deleteEvent(
    connection: CalendarConnectionRecord,
    providerEventId: string,
  ): Promise<ProviderEventResult>;
}
