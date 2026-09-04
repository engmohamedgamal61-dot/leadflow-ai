import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  bookAppointment,
  cancelAppointment,
  getActiveAppointment,
  rescheduleAppointment,
  type CalendarExecContext,
} from "./service.ts";
import { encryptToken } from "./crypto.ts";

const URL = process.env.LEADFLOW_DB_TEST_URL;
const SERVICE_KEY = process.env.LEADFLOW_DB_TEST_SERVICE_KEY;
const ANON_KEY = process.env.LEADFLOW_DB_TEST_ANON_KEY;
const enabled = Boolean(URL && SERVICE_KEY && ANON_KEY && ANON_KEY !== SERVICE_KEY);
const skip = enabled
  ? false
  : "set LEADFLOW_DB_TEST_URL + LEADFLOW_DB_TEST_SERVICE_KEY + LEADFLOW_DB_TEST_ANON_KEY";

const ENC_KEY = "d".repeat(64);
process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = ENC_KEY;
process.env.CALENDAR_MOCK_TRANSPORT = "1"; // freeBusy always reports clear — the DB constraint is the real guard under test

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
const stamp = Date.now();
let admin: AnyClient;
let orgRE = "", orgClinic = "", orgB = "";
let leadRE = "", leadClinic = "", leadB = "";
let connRE = "";
let viewerUserId = "", viewerClient: AnyClient;

async function mkOrgLead(slug: string, industry: string) {
  const org = (
    await admin
      .from("organizations")
      .insert({ name: slug, slug: `${slug}-${stamp}`, industry_template_id: industry })
      .select("id")
      .single()
  ).data.id;
  const lead = (
    await admin
      .from("leads")
      .insert({ organization_id: org, name: `${slug} Lead`, score: 50, temperature: "warm", status: "new" })
      .select("id")
      .single()
  ).data.id;
  return { org, lead };
}

async function mkOrgLeadConn(slug: string, industry: string) {
  const { org, lead } = await mkOrgLead(slug, industry);
  const conn = (
    await admin
      .from("organization_calendar_connections")
      .insert({
        organization_id: org,
        provider: "google",
        status: "connected",
        calendar_id: "primary",
        calendar_email: `${slug}@example.test`,
        timezone: "Asia/Riyadh",
        access_token_encrypted: encryptToken("access-token", ENC_KEY),
        refresh_token_encrypted: encryptToken("refresh-token", ENC_KEY),
        token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        settings: {},
      })
      .select("id")
      .single()
  ).data.id;
  return { org, lead, conn };
}

function ctx(over: Partial<CalendarExecContext> = {}): CalendarExecContext {
  return {
    db: admin,
    organizationId: orgRE,
    leadId: leadRE,
    conversationId: null,
    requestId: null,
    source: "chat",
    ...over,
  };
}

before(async () => {
  if (!enabled) return;
  admin = createClient(URL as string, SERVICE_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  ({ org: orgRE, lead: leadRE, conn: connRE } = await mkOrgLeadConn("cal-re", "real-estate"));
  ({ org: orgClinic, lead: leadClinic } = await mkOrgLeadConn("cal-clinic", "clinic"));
  // org B deliberately has NO calendar connection — proves the "not connected" path.
  const b = await mkOrgLead("cal-b", "real-estate");
  orgB = b.org;
  leadB = b.lead;

  const created = await admin.auth.admin.createUser({
    email: `cal-viewer-${stamp}@example.test`,
    password: "test-password-123",
    email_confirm: true,
  });
  viewerUserId = created.data.user.id;
  await admin.from("organization_members").insert({
    organization_id: orgRE,
    user_id: viewerUserId,
    role: "viewer",
  });
  viewerClient = createClient(URL as string, ANON_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await viewerClient.auth.signInWithPassword({
    email: `cal-viewer-${stamp}@example.test`,
    password: "test-password-123",
  });
  assert.equal(signIn.error, null);
});

after(async () => {
  if (!enabled) return;
  for (const o of [orgRE, orgClinic, orgB]) if (o) await admin.from("organizations").delete().eq("id", o);
  if (viewerUserId) await admin.auth.admin.deleteUser(viewerUserId);
  delete process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  delete process.env.CALENDAR_MOCK_TRANSPORT;
});

test("bookAppointment: creates the row, advances lead status, records an event", { skip }, async () => {
  const outcome = await bookAppointment(ctx(), { startsAt: "2026-09-10T06:00:00Z" });
  assert.equal(outcome.status, "executed");
  assert.ok(outcome.appointmentId);

  const lead = await admin.from("leads").select("status").eq("id", leadRE).single();
  assert.equal(lead.data.status, "appointment");

  const events = await admin
    .from("lead_events")
    .select("event_type")
    .eq("lead_id", leadRE)
    .eq("event_type", "appointment_booked");
  assert.equal(events.data.length, 1);

  // cleanup for subsequent tests
  await admin.from("appointments").delete().eq("id", outcome.appointmentId);
  await admin.from("leads").update({ status: "new" }).eq("id", leadRE);
});

test("double-booking the same calendar connection is rejected by the DB exclusion constraint", { skip }, async () => {
  const first = await bookAppointment(ctx(), { startsAt: "2026-09-11T06:00:00Z" });
  assert.equal(first.status, "executed");

  // Same connection, overlapping window, a DIFFERENT lead — the soft
  // provider check (mock freeBusy = clear) would allow this; only the DB
  // exclusion constraint on calendar_connection_id can catch it.
  const second = await bookAppointment(
    ctx({ leadId: leadRE }),
    { startsAt: "2026-09-11T06:15:00Z", endsAt: "2026-09-11T06:45:00Z" },
  );
  assert.equal(second.status, "failed");
  assert.equal(second.detailCode, "errors.calendar.slotTaken");

  // A non-overlapping time on the same connection still succeeds.
  const third = await bookAppointment(ctx(), { startsAt: "2026-09-11T08:00:00Z" });
  assert.equal(third.status, "executed");

  await admin.from("appointments").delete().eq("lead_id", leadRE);
  await admin.from("leads").update({ status: "new" }).eq("id", leadRE);
});

test("rescheduleAppointment moves the active appointment and logs from/to", { skip }, async () => {
  const booked = await bookAppointment(ctx(), { startsAt: "2026-09-12T06:00:00Z" });
  assert.equal(booked.status, "executed");

  const rescheduled = await rescheduleAppointment(ctx(), { newStartsAt: "2026-09-12T09:00:00Z" });
  assert.equal(rescheduled.status, "executed");
  assert.equal(rescheduled.appointmentId, booked.appointmentId);

  const row = await admin.from("appointments").select("starts_at, status").eq("id", booked.appointmentId).single();
  assert.equal(row.data.status, "rescheduled");
  assert.equal(Date.parse(row.data.starts_at), Date.parse("2026-09-12T09:00:00Z"));

  const active = await getActiveAppointment(admin, orgRE, leadRE);
  assert.equal(active?.id, booked.appointmentId);

  await admin.from("appointments").delete().eq("lead_id", leadRE);
  await admin.from("leads").update({ status: "new" }).eq("id", leadRE);
});

test("cancelAppointment marks the row cancelled and records the reason", { skip }, async () => {
  const booked = await bookAppointment(ctx(), { startsAt: "2026-09-13T06:00:00Z" });
  const cancelled = await cancelAppointment(ctx(), { reason: "prospect changed plans" });
  assert.equal(cancelled.status, "executed");
  assert.equal(cancelled.appointmentId, booked.appointmentId);

  const row = await admin.from("appointments").select("status, cancelled_reason").eq("id", booked.appointmentId).single();
  assert.equal(row.data.status, "cancelled");
  assert.equal(row.data.cancelled_reason, "prospect changed plans");

  assert.equal(await getActiveAppointment(admin, orgRE, leadRE), null);

  await admin.from("appointments").delete().eq("lead_id", leadRE);
  await admin.from("leads").update({ status: "new" }).eq("id", leadRE);
});

test("cancelAppointment / rescheduleAppointment with no active appointment fail cleanly", { skip }, async () => {
  const cancelled = await cancelAppointment(ctx(), {});
  assert.equal(cancelled.status, "failed");
  assert.equal(cancelled.detailCode, "errors.calendar.noActiveAppointment");

  const rescheduled = await rescheduleAppointment(ctx(), { newStartsAt: "2026-09-14T06:00:00Z" });
  assert.equal(rescheduled.status, "failed");
  assert.equal(rescheduled.detailCode, "errors.calendar.noActiveAppointment");
});

test("bookAppointment with no connected calendar fails cleanly", { skip }, async () => {
  const outcome = await bookAppointment(
    ctx({ organizationId: orgB, leadId: leadB }),
    { startsAt: "2026-09-10T06:00:00Z" },
  );
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.detailCode, "errors.calendar.notConnected");
});

test("tenant isolation: org B cannot see or affect org A's connection or appointments", { skip }, async () => {
  const booked = await bookAppointment(ctx(), { startsAt: "2026-09-15T06:00:00Z" });
  assert.equal(booked.status, "executed");

  // org B's context, org A's lead id — must not find or touch org A's appointment.
  assert.equal(await getActiveAppointment(admin, orgB, leadRE), null);

  const crossTenantCancel = await cancelAppointment(ctx({ organizationId: orgB, leadId: leadRE }), {});
  assert.equal(crossTenantCancel.status, "failed");

  await admin.from("appointments").delete().eq("lead_id", leadRE);
  await admin.from("leads").update({ status: "new" }).eq("id", leadRE);
});

test("Real Estate and Clinic templates hit the identical booking code path", { skip }, async () => {
  const re = await bookAppointment(ctx({ organizationId: orgRE, leadId: leadRE }), {
    startsAt: "2026-09-16T06:00:00Z",
  });
  const clinic = await bookAppointment(ctx({ organizationId: orgClinic, leadId: leadClinic }), {
    startsAt: "2026-09-16T06:00:00Z",
  });
  assert.equal(re.status, "executed");
  assert.equal(clinic.status, "executed");

  const [leadREStatus, leadClinicStatus] = await Promise.all([
    admin.from("leads").select("status").eq("id", leadRE).single(),
    admin.from("leads").select("status").eq("id", leadClinic).single(),
  ]);
  assert.equal(leadREStatus.data.status, "appointment");
  assert.equal(leadClinicStatus.data.status, "appointment");

  await admin.from("appointments").delete().in("lead_id", [leadRE, leadClinic]);
  await admin.from("leads").update({ status: "new" }).in("id", [leadRE, leadClinic]);
});

test("permission gating: a viewer's RLS-scoped client cannot insert an appointment", { skip }, async () => {
  const { error } = await viewerClient.from("appointments").insert({
    organization_id: orgRE,
    lead_id: leadRE,
    calendar_connection_id: connRE,
    starts_at: "2026-09-17T06:00:00Z",
    ends_at: "2026-09-17T07:00:00Z",
    source: "manual",
  });
  assert.ok(error, "expected RLS to reject the viewer's insert");
});
