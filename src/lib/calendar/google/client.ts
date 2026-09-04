/**
 * The Google Calendar REST transport — the ONLY place that knows Google's
 * request/response shapes. `service.ts` and everything above it only sees the
 * generic `CalendarProvider` interface (provider.ts).
 *
 * `GoogleHttpTransport` is an injection seam (mirrors
 * `whatsapp/meta-client.ts`'s `MetaTransport`): unit tests pass a fake and
 * never hit the network; `CALENDAR_MOCK_TRANSPORT=1` does the same for local
 * dev / E2E without a real Google Cloud OAuth client.
 */

import type {
  BusyInterval,
  CalendarConnectionRecord,
  CalendarProvider,
  CreateEventInput,
  ProviderEventResult,
  TimeRange,
  UpdateEventInput,
} from "../provider.ts";
import { refreshAccessToken, isTokenExpiring } from "./oauth.ts";

const API_BASE = "https://www.googleapis.com/calendar/v3";

export interface GoogleHttpTransport {
  freeBusy(input: {
    accessToken: string;
    calendarId: string;
    range: TimeRange;
  }): Promise<{ ok: true; busy: BusyInterval[] } | { ok: false; detail: string }>;
  insertEvent(input: {
    accessToken: string;
    calendarId: string;
    event: CreateEventInput;
  }): Promise<ProviderEventResult>;
  patchEvent(input: {
    accessToken: string;
    calendarId: string;
    event: UpdateEventInput;
  }): Promise<ProviderEventResult>;
  deleteEvent(input: {
    accessToken: string;
    calendarId: string;
    providerEventId: string;
  }): Promise<ProviderEventResult>;
}

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function eventBody(input: { summary?: string; description?: string; startsAt: string; endsAt: string; timezone: string }) {
  return {
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.description ? { description: input.description } : {}),
    start: { dateTime: input.startsAt, timeZone: input.timezone },
    end: { dateTime: input.endsAt, timeZone: input.timezone },
  };
}

/** Real transport: calls the live Google Calendar API. Never logs the token. */
export const fetchGoogleTransport: GoogleHttpTransport = {
  async freeBusy({ accessToken, calendarId, range }) {
    try {
      const res = await fetch(`${API_BASE}/freeBusy`, {
        method: "POST",
        headers: authHeaders(accessToken),
        body: JSON.stringify({
          timeMin: range.start,
          timeMax: range.end,
          items: [{ id: calendarId }],
        }),
      });
      const json = (await readJson(res)) as {
        calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        return { ok: false, detail: (json?.error?.message ?? `HTTP ${res.status}`).slice(0, 200) };
      }
      const busy = (json?.calendars?.[calendarId]?.busy ?? []).map((b) => ({
        startsAt: b.start,
        endsAt: b.end,
      }));
      return { ok: true, busy };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message.slice(0, 200) : "network error" };
    }
  },

  async insertEvent({ accessToken, calendarId, event }) {
    try {
      const res = await fetch(
        `${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
        { method: "POST", headers: authHeaders(accessToken), body: JSON.stringify(eventBody(event)) },
      );
      const json = (await readJson(res)) as { id?: string; error?: { message?: string } } | null;
      if (!res.ok || !json?.id) {
        return { ok: false, errorDetail: (json?.error?.message ?? `HTTP ${res.status}`).slice(0, 200) };
      }
      return { ok: true, providerEventId: json.id };
    } catch (error) {
      return { ok: false, errorDetail: error instanceof Error ? error.message.slice(0, 200) : "network error" };
    }
  },

  async patchEvent({ accessToken, calendarId, event }) {
    try {
      const res = await fetch(
        `${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(event.providerEventId)}`,
        { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify(eventBody(event)) },
      );
      const json = (await readJson(res)) as { id?: string; error?: { message?: string } } | null;
      if (!res.ok) {
        return { ok: false, errorDetail: (json?.error?.message ?? `HTTP ${res.status}`).slice(0, 200) };
      }
      return { ok: true, providerEventId: json?.id ?? event.providerEventId };
    } catch (error) {
      return { ok: false, errorDetail: error instanceof Error ? error.message.slice(0, 200) : "network error" };
    }
  },

  async deleteEvent({ accessToken, calendarId, providerEventId }) {
    try {
      const res = await fetch(
        `${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(providerEventId)}`,
        { method: "DELETE", headers: authHeaders(accessToken) },
      );
      // Google returns 410 Gone for an already-deleted event — treat as success.
      if (!res.ok && res.status !== 404 && res.status !== 410) {
        const json = (await readJson(res)) as { error?: { message?: string } } | null;
        return { ok: false, errorDetail: (json?.error?.message ?? `HTTP ${res.status}`).slice(0, 200) };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, errorDetail: error instanceof Error ? error.message.slice(0, 200) : "network error" };
    }
  },
};

/** A no-network transport for local development / E2E. */
export const mockGoogleTransport: GoogleHttpTransport = {
  async freeBusy() {
    return { ok: true, busy: [] };
  },
  async insertEvent() {
    return { ok: true, providerEventId: `mock-event-${Math.random().toString(36).slice(2, 12)}` };
  },
  async patchEvent({ event }) {
    return { ok: true, providerEventId: event.providerEventId };
  },
  async deleteEvent() {
    return { ok: true };
  },
};

export function getGoogleTransport(): GoogleHttpTransport {
  return process.env.CALENDAR_MOCK_TRANSPORT === "1" ? mockGoogleTransport : fetchGoogleTransport;
}

/** Build the `CalendarProvider` for Google, backed by `transport` (defaults to the env-selected one). */
export function createGoogleCalendarProvider(
  transport: GoogleHttpTransport = getGoogleTransport(),
): CalendarProvider {
  return {
    id: "google",

    async ensureFreshToken(connection) {
      if (!isTokenExpiring(connection.tokenExpiresAt)) {
        return { accessToken: connection.accessToken, expiresAt: connection.tokenExpiresAt };
      }
      const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
      if (!clientId || !clientSecret || !connection.refreshToken) return null;
      const refreshed = await refreshAccessToken({ clientId, clientSecret }, connection.refreshToken);
      if (!refreshed.ok) return null;
      return { accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt };
    },

    async getBusyIntervals(connection: CalendarConnectionRecord, range: TimeRange) {
      if (!connection.calendarId) return [];
      const result = await transport.freeBusy({
        accessToken: connection.accessToken,
        calendarId: connection.calendarId,
        range,
      });
      if (!result.ok) {
        console.error("[calendar:google] freeBusy failed:", result.detail);
        return [];
      }
      return result.busy;
    },

    async createEvent(connection, input: CreateEventInput) {
      if (!connection.calendarId) return { ok: false, errorDetail: "no calendar selected" };
      return transport.insertEvent({
        accessToken: connection.accessToken,
        calendarId: connection.calendarId,
        event: { ...input, summary: input.summary || "Appointment" },
      });
    },

    async updateEvent(connection, input: UpdateEventInput) {
      if (!connection.calendarId) return { ok: false, errorDetail: "no calendar selected" };
      return transport.patchEvent({
        accessToken: connection.accessToken,
        calendarId: connection.calendarId,
        event: input,
      });
    },

    async deleteEvent(connection, providerEventId: string) {
      if (!connection.calendarId) return { ok: false, errorDetail: "no calendar selected" };
      return transport.deleteEvent({
        accessToken: connection.accessToken,
        calendarId: connection.calendarId,
        providerEventId,
      });
    },
  };
}
