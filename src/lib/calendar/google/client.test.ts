import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGoogleCalendarProvider,
  mockGoogleTransport,
  type GoogleHttpTransport,
} from "./client.ts";
import type { CalendarConnectionRecord } from "../provider.ts";
import { DEFAULT_CALENDAR_SETTINGS } from "../config.ts";

function connection(over: Partial<CalendarConnectionRecord> = {}): CalendarConnectionRecord {
  return {
    id: "conn-1",
    organizationId: "org-1",
    provider: "google",
    status: "connected",
    calendarId: "primary",
    calendarEmail: "org@example.test",
    timezone: "Asia/Riyadh",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    settings: DEFAULT_CALENDAR_SETTINGS,
    ...over,
  };
}

function fakeTransport(over: Partial<GoogleHttpTransport> = {}): GoogleHttpTransport {
  return {
    async freeBusy() {
      return { ok: true, busy: [{ startsAt: "2026-09-06T07:00:00Z", endsAt: "2026-09-06T08:00:00Z" }] };
    },
    async insertEvent() {
      return { ok: true, providerEventId: "evt-1" };
    },
    async patchEvent({ event }) {
      return { ok: true, providerEventId: event.providerEventId };
    },
    async deleteEvent() {
      return { ok: true };
    },
    ...over,
  };
}

test("getBusyIntervals maps the transport's busy list straight through", async () => {
  const provider = createGoogleCalendarProvider(fakeTransport());
  const busy = await provider.getBusyIntervals(connection(), {
    start: "2026-09-06T00:00:00Z",
    end: "2026-09-07T00:00:00Z",
  });
  assert.deepEqual(busy, [{ startsAt: "2026-09-06T07:00:00Z", endsAt: "2026-09-06T08:00:00Z" }]);
});

test("getBusyIntervals returns [] (never throws) when the transport fails", async () => {
  const provider = createGoogleCalendarProvider(
    fakeTransport({ freeBusy: async () => ({ ok: false, detail: "boom" }) }),
  );
  const busy = await provider.getBusyIntervals(connection(), {
    start: "2026-09-06T00:00:00Z",
    end: "2026-09-07T00:00:00Z",
  });
  assert.deepEqual(busy, []);
});

test("getBusyIntervals returns [] when no calendar is selected yet", async () => {
  const provider = createGoogleCalendarProvider(fakeTransport());
  const busy = await provider.getBusyIntervals(connection({ calendarId: null }), {
    start: "2026-09-06T00:00:00Z",
    end: "2026-09-07T00:00:00Z",
  });
  assert.deepEqual(busy, []);
});

test("createEvent / updateEvent / deleteEvent delegate to the transport", async () => {
  const calls: string[] = [];
  const provider = createGoogleCalendarProvider(
    fakeTransport({
      insertEvent: async () => {
        calls.push("insert");
        return { ok: true, providerEventId: "evt-42" };
      },
      patchEvent: async () => {
        calls.push("patch");
        return { ok: true, providerEventId: "evt-42" };
      },
      deleteEvent: async () => {
        calls.push("delete");
        return { ok: true };
      },
    }),
  );
  const conn = connection();

  const created = await provider.createEvent(conn, {
    summary: "Appointment",
    startsAt: "2026-09-06T06:00:00Z",
    endsAt: "2026-09-06T07:00:00Z",
    timezone: "Asia/Riyadh",
  });
  assert.equal(created.ok, true);
  assert.equal(created.providerEventId, "evt-42");

  const updated = await provider.updateEvent(conn, {
    providerEventId: "evt-42",
    startsAt: "2026-09-06T08:00:00Z",
    endsAt: "2026-09-06T09:00:00Z",
    timezone: "Asia/Riyadh",
  });
  assert.equal(updated.ok, true);

  const deleted = await provider.deleteEvent(conn, "evt-42");
  assert.equal(deleted.ok, true);

  assert.deepEqual(calls, ["insert", "patch", "delete"]);
});

test("ensureFreshToken: unexpired token is returned unchanged, no refresh call", async () => {
  const provider = createGoogleCalendarProvider(fakeTransport());
  const conn = connection({ tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString() });
  const fresh = await provider.ensureFreshToken(conn);
  assert.deepEqual(fresh, { accessToken: conn.accessToken, expiresAt: conn.tokenExpiresAt });
});

test("ensureFreshToken: expiring token refreshes via the mock OAuth transport", async () => {
  process.env.CALENDAR_MOCK_TRANSPORT = "1";
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "id";
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "secret";
  try {
    const provider = createGoogleCalendarProvider(fakeTransport());
    const conn = connection({ tokenExpiresAt: new Date(Date.now() - 1000).toISOString() });
    const fresh = await provider.ensureFreshToken(conn);
    assert.ok(fresh);
    assert.notEqual(fresh?.accessToken, conn.accessToken);
  } finally {
    delete process.env.CALENDAR_MOCK_TRANSPORT;
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  }
});

test("ensureFreshToken: missing client credentials → null (never throws)", async () => {
  const provider = createGoogleCalendarProvider(fakeTransport());
  const conn = connection({ tokenExpiresAt: new Date(Date.now() - 1000).toISOString() });
  const fresh = await provider.ensureFreshToken(conn);
  assert.equal(fresh, null);
});

test("mockGoogleTransport never touches the network and always succeeds", async () => {
  const busy = await mockGoogleTransport.freeBusy({
    accessToken: "x",
    calendarId: "primary",
    range: { start: "2026-09-06T00:00:00Z", end: "2026-09-07T00:00:00Z" },
  });
  assert.deepEqual(busy, { ok: true, busy: [] });

  const created = await mockGoogleTransport.insertEvent({
    accessToken: "x",
    calendarId: "primary",
    event: { summary: "x", startsAt: "2026-09-06T06:00:00Z", endsAt: "2026-09-06T07:00:00Z", timezone: "UTC" },
  });
  assert.equal(created.ok, true);
  assert.ok(created.providerEventId);
});
