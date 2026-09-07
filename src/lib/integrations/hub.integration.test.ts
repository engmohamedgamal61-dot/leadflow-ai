import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { fanOutOutbox } from "./fanout.ts";
import { runIntegrationHub } from "./worker.ts";
import { handleInboundAction } from "./inbound.ts";
import { parseInboundRequest } from "./inbound-validation.ts";
import {
  buildSignatureHeaders,
  verifySignature,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from "./signature.ts";
import { encryptEndpointSecret, generateEndpointSecret, secretHint } from "./secret.ts";
import type { FetchLike } from "./delivery.ts";

/**
 * Real-Postgres tests for the Integration Hub. Skipped without local Supabase.
 * Covers: tenant isolation, signature verification, retry/backoff, idempotent
 * fan-out, disabled endpoints, secret rotation, event filtering, the inbound
 * action allowlist, and cross-org rejection.
 *
 *   INTEGRATION_TOKEN_ENCRYPTION_KEY=<64 hex>  is also required.
 */
const URL = process.env.LEADFLOW_DB_TEST_URL;
const SERVICE_KEY = process.env.LEADFLOW_DB_TEST_SERVICE_KEY;
const ANON_KEY = process.env.LEADFLOW_DB_TEST_ANON_KEY;
const enabled = Boolean(
  URL && SERVICE_KEY && ANON_KEY && ANON_KEY !== SERVICE_KEY &&
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY,
);
const skip = enabled
  ? false
  : "set LEADFLOW_DB_TEST_* + INTEGRATION_TOKEN_ENCRYPTION_KEY";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
const stamp = Date.now();
let admin: AnyClient;
const users: Record<string, { id: string; client: AnyClient }> = {};
let orgA = "", orgB = "", leadA = "", leadB = "";
const SECRETS = new Map<string, string>();

/** A fetch stub that returns a chosen status and records calls. */
function stubFetch(status: number): { fetch: FetchLike; calls: { url: string; body: string; headers: Record<string, string> }[] } {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body, headers: init.headers });
    return { status, text: async () => (status >= 300 ? "err" : "ok") };
  };
  return { fetch, calls };
}

async function makeUser(tag: string) {
  const email = `hub-it-${tag}-${stamp}@example.test`;
  const c = await admin.auth.admin.createUser({ email, password: "test-password-123", email_confirm: true });
  if (c.error) throw c.error;
  const client = createClient(URL as string, ANON_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const s = await client.auth.signInWithPassword({ email, password: "test-password-123" });
  if (s.error) throw s.error;
  users[tag] = { id: c.data.user.id, client };
}

async function makeEndpoint(org: string, over: Record<string, unknown> = {}): Promise<string> {
  const secret = generateEndpointSecret();
  const { data, error } = await admin
    .from("integration_endpoints")
    .insert({
      organization_id: org,
      name: "hook",
      url: "https://consumer.example.test/hook",
      secret_encrypted: encryptEndpointSecret(secret),
      secret_hint: secretHint(secret),
      subscribed_events: ["lead.qualified", "lead.status_changed"],
      ...over,
    })
    .select("id")
    .single();
  if (error) throw error;
  SECRETS.set(data.id, secret);
  return data.id;
}

before(async () => {
  if (!enabled) return;
  admin = createClient(URL as string, SERVICE_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await makeUser("a");
  await makeUser("b");
  await makeUser("v");
  orgA = (await users.a.client.rpc("create_organization_with_owner", {
    p_name: "Hub IT A", p_industry_template_id: "real-estate",
  })).data.id;
  orgB = (await users.b.client.rpc("create_organization_with_owner", {
    p_name: "Hub IT B", p_industry_template_id: "clinic",
  })).data.id;
  await users.a.client.from("organization_members").insert([
    { organization_id: orgA, user_id: users.v.id, role: "viewer" },
  ]);
  leadA = (await admin.from("leads").insert({
    organization_id: orgA, name: "Lead A", score: 50, temperature: "warm", status: "new",
  }).select("id").single()).data.id;
  leadB = (await admin.from("leads").insert({
    organization_id: orgB, name: "Lead B", score: 50, temperature: "warm", status: "new",
  }).select("id").single()).data.id;
});

after(async () => {
  if (!enabled) return;
  for (const o of [orgA, orgB]) if (o) await admin.from("organizations").delete().eq("id", o);
  for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id);
});

test("a subscribed domain event fans out and delivers (signed)", { skip }, async () => {
  const ep = await makeEndpoint(orgA);
  // emit a lead_qualified domain event → trigger enqueues an outbox row
  await admin.from("lead_events").insert({
    organization_id: orgA, lead_id: leadA, event_type: "lead_qualified", metadata: { source: "test" },
  });

  const { fetch, calls } = stubFetch(200);
  const summary = await runIntegrationHub({ db: admin, fetchImpl: fetch });
  assert.ok(summary.deliveriesCreated >= 1);
  assert.equal(summary.succeeded, 1);
  assert.equal(calls.length, 1);

  // the delivery body verifies against the endpoint secret
  const secret = SECRETS.get(ep)!;
  const v = verifySignature({
    secret,
    body: calls[0].body,
    signatureHeader: calls[0].headers[SIGNATURE_HEADER],
    timestampHeader: calls[0].headers[TIMESTAMP_HEADER],
  });
  assert.equal(v.ok, true);
  const envelope = JSON.parse(calls[0].body);
  assert.equal(envelope.type, "lead.qualified");
  assert.equal(envelope.data.lead.id, leadA);

  const row = (await admin.from("integration_deliveries").select("status").eq("endpoint_id", ep).single()).data;
  assert.equal(row.status, "succeeded");
});

test("event filtering: an unsubscribed event never creates a delivery", { skip }, async () => {
  const ep = await makeEndpoint(orgA, { subscribed_events: ["appointment.booked"] });
  await admin.from("lead_events").insert({
    organization_id: orgA, lead_id: leadA, event_type: "lead_created", metadata: { score: 1 },
  });
  await runIntegrationHub({ db: admin, fetchImpl: stubFetch(200).fetch });
  const rows = (await admin.from("integration_deliveries").select("id").eq("endpoint_id", ep)).data;
  assert.equal(rows.length, 0);
});

test("idempotent fan-out: re-running never double-creates deliveries", { skip }, async () => {
  const ep = await makeEndpoint(orgA);
  await admin.from("lead_events").insert({
    organization_id: orgA, lead_id: leadA, event_type: "status_changed", metadata: { from: "new", to: "contacted" },
  });
  await fanOutOutbox(admin);
  await fanOutOutbox(admin); // second pass
  const rows = (await admin.from("integration_deliveries").select("id").eq("endpoint_id", ep)).data;
  assert.equal(rows.length, 1);
});

test("retry/backoff: a 500 marks the delivery failed with a future next_attempt_at", { skip }, async () => {
  const ep = await makeEndpoint(orgA);
  await admin.from("lead_events").insert({
    organization_id: orgA, lead_id: leadA, event_type: "lead_qualified", metadata: {},
  });
  await runIntegrationHub({ db: admin, fetchImpl: stubFetch(500).fetch, now: new Date() });
  const row = (await admin.from("integration_deliveries").select("status, attempt_count, next_attempt_at").eq("endpoint_id", ep).single()).data;
  assert.equal(row.status, "failed");
  assert.equal(row.attempt_count, 1);
  assert.ok(new Date(row.next_attempt_at).getTime() > Date.now());

  const epRow = (await admin.from("integration_endpoints").select("consecutive_failures").eq("id", ep).single()).data;
  assert.equal(epRow.consecutive_failures, 1);
});

test("disabled endpoint: events do not deliver", { skip }, async () => {
  // Isolate: only a single disabled endpoint in this org.
  await admin.from("integration_endpoints").delete().eq("organization_id", orgA);
  const ep = await makeEndpoint(orgA, { enabled: false });
  await admin.from("lead_events").insert({
    organization_id: orgA, lead_id: leadA, event_type: "lead_qualified", metadata: {},
  });
  const { fetch, calls } = stubFetch(200);
  const summary = await runIntegrationHub({ db: admin, fetchImpl: fetch });
  assert.equal(calls.length, 0);
  assert.equal(summary.deliveriesCreated, 0);
  const rows = (await admin.from("integration_deliveries").select("id").eq("endpoint_id", ep)).data;
  assert.equal(rows.length, 0, "no delivery for a disabled endpoint");
});

test("tenant isolation: org B cannot see org A's endpoints or deliveries", { skip }, async () => {
  const ep = await makeEndpoint(orgA);
  await admin.from("lead_events").insert({
    organization_id: orgA, lead_id: leadA, event_type: "lead_qualified", metadata: {},
  });
  await runIntegrationHub({ db: admin, fetchImpl: stubFetch(200).fetch });

  const bEndpoints = (await users.b.client.from("integration_endpoints").select("id")).data;
  assert.ok(!bEndpoints.some((r: { id: string }) => r.id === ep));
  const bDeliveries = (await users.b.client.from("integration_deliveries").select("id").eq("endpoint_id", ep)).data;
  assert.equal(bDeliveries.length, 0);

  // owner A sees them
  const aEndpoints = (await users.a.client.from("integration_endpoints").select("id, secret_hint")).data;
  assert.ok(aEndpoints.some((r: { id: string }) => r.id === ep));
  // ...but never the encrypted secret column
  const leaked = await users.a.client.from("integration_endpoints").select("secret_encrypted").eq("id", ep);
  assert.ok(leaked.error, "secret_encrypted must be column-revoked from authenticated");
});

test("viewer cannot create an endpoint (RLS)", { skip }, async () => {
  const res = await users.v.client.from("integration_endpoints").insert({
    organization_id: orgA, name: "x", url: "https://x.test", secret_encrypted: "x", secret_hint: "x",
  });
  assert.ok(res.error, "viewer insert must be rejected by RLS");
});

test("inbound: valid signed request runs an allowlisted action, idempotently", { skip }, async () => {
  const ep = await makeEndpoint(orgA);
  const secret = SECRETS.get(ep)!;
  const body = JSON.stringify({
    id: `idem-${stamp}`, action: "update_lead_status", leadId: leadA, status: "contacted",
  });
  const headers = buildSignatureHeaders(secret, body);
  const v = verifySignature({
    secret, body,
    signatureHeader: headers[SIGNATURE_HEADER], timestampHeader: headers[TIMESTAMP_HEADER],
  });
  assert.equal(v.ok, true);

  const parsed = parseInboundRequest(JSON.parse(body));
  if (!parsed.ok) throw new Error(parsed.code);

  const r1 = await handleInboundAction(admin, {
    endpoint: { id: ep, organization_id: orgA }, parsed: parsed.value,
  });
  assert.equal(r1.httpStatus, 200);
  assert.equal(r1.body.status, "accepted");

  const r2 = await handleInboundAction(admin, {
    endpoint: { id: ep, organization_id: orgA }, parsed: parsed.value,
  });
  assert.equal(r2.body.status, "duplicate");

  const audit = (await admin.from("integration_inbound_actions").select("id, request_summary").eq("endpoint_id", ep)).data;
  assert.equal(audit.length, 1, "one audit row for a retried request");
  assert.ok(!JSON.stringify(audit[0].request_summary).includes("sha256"), "no signature in the audit");
});

test("inbound: an action targeting another org's lead is rejected", { skip }, async () => {
  const ep = await makeEndpoint(orgA);
  const parsed = parseInboundRequest({
    id: `cross-${stamp}`, action: "request_human_handoff", leadId: leadB,
  });
  if (!parsed.ok) throw new Error(parsed.code);
  const r = await handleInboundAction(admin, {
    endpoint: { id: ep, organization_id: orgA }, parsed: parsed.value,
  });
  assert.equal(r.httpStatus, 404);
  assert.equal(r.body.error_code, "lead_not_found");
});

test("secret rotation invalidates the previous signature", { skip }, async () => {
  const ep = await makeEndpoint(orgA);
  const oldSecret = SECRETS.get(ep)!;
  const newSecret = generateEndpointSecret();
  await admin.from("integration_endpoints").update({
    secret_encrypted: encryptEndpointSecret(newSecret),
    secret_hint: secretHint(newSecret),
    secret_rotated_at: new Date().toISOString(),
  }).eq("id", ep);

  const body = JSON.stringify({ id: "x", action: "request_human_handoff", leadId: leadA });
  const oldHeaders = buildSignatureHeaders(oldSecret, body);
  assert.equal(
    verifySignature({
      secret: newSecret, body,
      signatureHeader: oldHeaders[SIGNATURE_HEADER], timestampHeader: oldHeaders[TIMESTAMP_HEADER],
    }).ok,
    false,
  );
});
