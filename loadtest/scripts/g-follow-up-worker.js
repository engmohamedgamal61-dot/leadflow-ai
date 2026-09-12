// Scenario G — Follow-up worker: seed a large due batch (direct PostgREST
// insert into lead_follow_ups, service-role, scheduled_at in the past), then
// hit POST /api/internal/follow-ups/run from SEVERAL VUs concurrently and as
// close to simultaneously as k6 can manage — the real test of
// claim_due_follow_ups' `FOR UPDATE SKIP LOCKED`: two concurrent workers must
// never claim (and so never double-process) the same row.
//
// Post-run correctness (row counts: pending vs. completed/failed, and that
// completed+failed == batch size, no row double-counted) is verified
// separately against the real DB — see loadtest/README.md and report §G.
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";
import { SUPABASE_URL, orgs } from "./lib/config.js";

const APP_URL = __ENV.APP_URL || "http://localhost:3100";
const SERVICE_KEY = __ENV.SUPABASE_SERVICE_KEY;
const CRON_SECRET = __ENV.FOLLOW_UP_CRON_SECRET || "loadtest-follow-up-cron-secret-0123456789";
const BATCH_SIZE = Number(__ENV.FOLLOWUP_BATCH || 500);

export const followUpsSeeded = new Counter("followups_seeded");
export const workerRuns = new Counter("followup_worker_runs");
export const workerClaimed = new Counter("followup_worker_claimed_total");
export const errorRate = new Rate("scenario_errors");

export const options = {
  scenarios: {
    concurrent_workers: {
      executor: "shared-iterations",
      vus: Number(__ENV.VUS || 5),
      iterations: Number(__ENV.RUNS || 15),
      maxDuration: "60s",
    },
  },
};

export function setup() {
  const org = orgs[0];
  const leadRes = http.get(
    `${SUPABASE_URL}/rest/v1/leads?organization_id=eq.${org.organizationId}&select=id&limit=1`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  const rows = leadRes.json();
  const leadId = Array.isArray(rows) && rows.length > 0 ? rows[0].id : null;
  if (!leadId) return { seeded: 0 };

  const past = new Date(Date.now() - 3600_000).toISOString();
  const batch = [];
  for (let i = 0; i < BATCH_SIZE; i += 1) {
    batch.push({
      organization_id: org.organizationId,
      lead_id: leadId,
      scheduled_at: past,
      status: "pending",
      source: "manual",
      note: `loadtest follow-up ${i}`,
    });
  }
  // PostgREST accepts a bulk insert as a JSON array.
  const res = http.post(`${SUPABASE_URL}/rest/v1/lead_follow_ups`, JSON.stringify(batch), {
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: "return=minimal",
    },
  });
  const ok = res.status >= 200 && res.status < 300;
  console.log(`seeded ${BATCH_SIZE} due follow-ups: ${res.status}`);
  return { seeded: ok ? BATCH_SIZE : 0 };
}

export default function (data) {
  if (data.seeded > 0) followUpsSeeded.add(data.seeded, { once: __ITER === 0 && __VU === 1 });

  const res = http.post(`${APP_URL}/api/internal/follow-ups/run`, null, {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  const ok = check(res, { "follow-up run: 200": (r) => r.status === 200 });
  errorRate.add(!ok);
  if (ok) {
    workerRuns.add(1);
    try {
      const body = res.json();
      if (typeof body.claimed === "number") workerClaimed.add(body.claimed);
    } catch {
      // ignore parse errors for the metric only
    }
  }
  sleep(0.2);
}
