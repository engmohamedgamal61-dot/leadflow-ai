// Scenario F — Integration Hub: enqueue domain events (direct PostgREST
// insert into lead_events, service-role — the same trigger path a real
// lead-qualified event takes), worker claim (POST /api/internal/integrations/
// run, the real cron route), delivery success, and retry behavior.
//
// Requires: loadtest/seed/setup-integration-hub.mjs already run (one endpoint
// per org, pointed at webhook-receiver-mock.mjs).
//
// Failure injection: pass -e WEBHOOK_SCENARIO=fail_500 (or `timeout`) to have
// setup() flip the mock webhook receiver's /_control/scenario before the run,
// so deliveries fail/hang and you can observe retry-scheduling. Omit it (or
// pass `ok`) for the normal delivery-success path. WEBHOOK_CONTROL_URL points
// at the mock's control endpoint if it's not running on the default port.
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";
import { SUPABASE_URL, orgs } from "./lib/config.js";

const APP_URL = __ENV.APP_URL || "http://localhost:3100";
const SERVICE_KEY = __ENV.SUPABASE_SERVICE_KEY;
const CRON_SECRET = __ENV.INTEGRATION_HUB_CRON_SECRET || "loadtest-integration-hub-cron-secret-0123456789";
const WEBHOOK_CONTROL = __ENV.WEBHOOK_CONTROL_URL || "http://localhost:9102";
// "ok" | "fail_500" | "timeout" — see webhook-receiver-mock.mjs. Unset = leave
// the mock's current scenario alone (defaults to "ok" on its own startup).
const WEBHOOK_SCENARIO = __ENV.WEBHOOK_SCENARIO || null;

export const eventsEnqueued = new Counter("hub_events_enqueued");
export const workerRuns = new Counter("hub_worker_runs");
export const errorRate = new Rate("scenario_errors");

export const options = {
  scenarios: {
    enqueue: {
      executor: "shared-iterations",
      vus: Number(__ENV.VUS || 10),
      iterations: Number(__ENV.EVENTS || 100),
      maxDuration: "60s",
      exec: "enqueue",
    },
    claim: {
      executor: "constant-vus",
      vus: 1,
      duration: __ENV.CLAIM_DURATION || "20s",
      exec: "claim",
      startTime: "10s",
    },
  },
};

function restHeaders() {
  return {
    "Content-Type": "application/json",
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    Prefer: "return=minimal",
  };
}

// Sets the mock webhook's failure-injection scenario (if requested), then
// caches one lead id per org — both run once, before the VUs start.
export function setup() {
  if (WEBHOOK_SCENARIO) {
    const res = http.post(
      `${WEBHOOK_CONTROL}/_control/scenario`,
      JSON.stringify({ scenario: WEBHOOK_SCENARIO }),
      { headers: { "Content-Type": "application/json" } },
    );
    check(res, { "webhook scenario set": (r) => r.status === 200 });
  }

  const leadByOrg = {};
  for (const org of orgs) {
    const res = http.get(
      `${SUPABASE_URL}/rest/v1/leads?organization_id=eq.${org.organizationId}&select=id&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    const rows = res.json();
    if (Array.isArray(rows) && rows.length > 0) {
      leadByOrg[org.organizationId] = rows[0].id;
    }
  }
  return { leadByOrg };
}

export function enqueue(data) {
  const org = orgs[__VU % orgs.length];
  const leadId = data.leadByOrg[org.organizationId];
  if (!leadId) return;

  const res = http.post(
    `${SUPABASE_URL}/rest/v1/lead_events`,
    JSON.stringify({
      organization_id: org.organizationId,
      lead_id: leadId,
      event_type: "lead_qualified",
      metadata: { source: "loadtest" },
    }),
    { headers: restHeaders() },
  );
  const ok = check(res, { "enqueue: 2xx/409": (r) => r.status < 300 || r.status === 409 });
  errorRate.add(!ok);
  if (ok) eventsEnqueued.add(1);
}

export function claim() {
  const res = http.post(`${APP_URL}/api/internal/integrations/run`, null, {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  const ok = check(res, { "worker run: 200": (r) => r.status === 200 });
  errorRate.add(!ok);
  if (ok) workerRuns.add(1);
  sleep(1);
}
