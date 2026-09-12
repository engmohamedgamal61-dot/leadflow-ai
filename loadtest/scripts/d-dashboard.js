// Scenario D — Dashboard: counts overview, leads list pagination. Real
// authenticated sessions (lib/auth.js) against the real app.
//
// HARNESS LIMITATION #1 (confirmed, not a product finding): re-using the same
// hand-constructed session cookie across multiple requests in one VU produces
// intermittent redirect-to-/login failures (~25-30% at even 10 VU) that
// disappear completely (0/20 in a dedicated check) when the cookie is
// re-issued before every request. Most likely cause: this app's middleware
// (src/proxy.ts) rewrites/refreshes the Supabase session cookie on response
// (a standard @supabase/ssr SSR pattern), and if the rewritten session is
// large enough to cross @supabase/ssr's 3180-byte chunk threshold
// (cookies.js MAX_CHUNK_SIZE), it gets split into `sb-127-auth-token.0/.1/...`
// — a harness that (like this one) only tracks the single unchunked cookie
// name loses the session on the next request, exactly matching
// cookies.js's own documented failure mode ("chunks from different writes
// were combined ... invalid JSON, treating as absent"). A real browser's
// @supabase/ssr client handles this natively. Worked around here by
// re-authenticating before every request — costs one extra GoTrue round trip
// per iteration (measured separately as `dashboard_login_duration`, excluded
// from the page-latency metrics below) but gets a clean, trustworthy read
// on actual page latency. A browser-based (Playwright) lane would be needed
// to validate real session persistence under concurrency without this gap.
//
// HARNESS LIMITATION #2: the AI Sales
// Manager ("Ask LeadFlow") query round-trip is invoked via a Next.js Server
// Action (src/lib/sales-manager/service.ts, called from a "use server"
// action, not a REST route) — its wire protocol (Next-Action header + React
// Flight argument encoding) is version-coupled to the exact Next/React build
// and impractical to replicate reliably from k6 without modifying
// application code, which this phase avoids. This script load-tests the
// /dashboard/ask PAGE SHELL only (SSR render, no query); the underlying
// Sales Manager query/answer latency under concurrent load is NOT TESTED by
// this harness — see docs/... report section C.
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";
import { APP_URL, pickOrg } from "./lib/config.js";
import { loginAndSetCookie } from "./lib/auth.js";

export const loginDuration = new Trend("dashboard_login_duration", true);
export const dashboardDuration = new Trend("dashboard_duration", true);
export const leadsListDuration = new Trend("leads_list_duration", true);
export const askShellDuration = new Trend("ask_shell_duration", true);
export const errorRate = new Rate("scenario_errors");

export const options = {
  scenarios: {
    dashboard: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 10),
      duration: __ENV.DURATION || "30s",
    },
  },
  thresholds: { scenario_errors: ["rate<0.01"] },
};

export function setup() {
  // Login once per VU is expensive (bcrypt on the auth server) — k6 doesn't
  // give us a clean per-VU setup hook, so each VU logs in on its first
  // iteration and the cookie jar (per-VU by default) keeps it for the rest.
}

export default function () {
  const org = pickOrg(__VU);
  const jar = http.cookieJar();

  // Re-authenticate every iteration — see HARNESS LIMITATION #1 above.
  const loginStart = Date.now();
  loginAndSetCookie(jar, org.ownerEmail, org.ownerPassword);
  loginDuration.add(Date.now() - loginStart);

  const dash = http.get(`${APP_URL}/dashboard`);
  dashboardDuration.add(dash.timings.duration);
  const dashOk = check(dash, {
    "dashboard 200": (r) => r.status === 200,
    "not redirected to login": (r) => !r.url.includes("/login"),
  });
  errorRate.add(!dashOk);

  const page = 1 + (__ITER % 3);
  const leads = http.get(`${APP_URL}/dashboard/leads?page=${page}`);
  leadsListDuration.add(leads.timings.duration);
  const leadsOk = check(leads, { "leads list 200": (r) => r.status === 200 });
  errorRate.add(!leadsOk);

  const ask = http.get(`${APP_URL}/dashboard/ask`);
  askShellDuration.add(ask.timings.duration);
  const askOk = check(ask, { "ask shell 200": (r) => r.status === 200 });
  errorRate.add(!askOk);

  sleep(1);
}
