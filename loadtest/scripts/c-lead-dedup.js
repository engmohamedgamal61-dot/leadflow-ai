// Scenario C — Lead dedup pressure: repeated phone traffic, same org and
// across orgs. Uses the mock's PHONE:<digits> trigger (anthropic-mock-server.mjs)
// so dedup is driven by a KNOWN, controlled phone number rather than the
// model's free-text guess. Only "clinic"-template orgs have `phone` as an
// extractable leadField (src/lib/config/templates/clinic.ts) — real-estate's
// template doesn't (src/lib/config/templates/real-estate.ts) — so this
// scenario targets clinic orgs specifically; see loadtest/README.md.
//
// Every VU in the "same_org_same_phone" group hits ONE fixed org with the
// SAME phone number — this is the actual dedup-contention stress case
// (many concurrent anonymous sessions racing to attach to one lead row).
// "cross_org_same_phone" sends the identical phone to DIFFERENT orgs, to
// prove dedup never merges across tenants even on an identical contact value.
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";
import { APP_URL, WIDGET_ORIGIN, orgs, syntheticIp } from "./lib/config.js";

const clinicOrgs = orgs.filter((o) => o.industryTemplateId === "clinic");
const FIXED_PHONE = "0555551234";

export const errorRate = new Rate("scenario_errors");

export const options = {
  scenarios: {
    same_org_same_phone: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS_SAME_ORG || 10),
      duration: __ENV.DURATION || "20s",
      exec: "sameOrgSamePhone",
    },
    cross_org_same_phone: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS_CROSS_ORG || 10),
      duration: __ENV.DURATION || "20s",
      exec: "crossOrgSamePhone",
      startTime: __ENV.DURATION || "20s",
    },
  },
  thresholds: { scenario_errors: ["rate<0.02"] },
};

function sendPhone(org, ip, phone) {
  const res = http.post(
    `${APP_URL}/api/chat`,
    JSON.stringify({
      messages: [{ role: "user", content: `Hi, my number is PHONE:${phone}, I'd like to book.` }],
      widgetKey: org.widgetKey,
      pageOrigin: WIDGET_ORIGIN,
    }),
    {
      headers: { "Content-Type": "application/json", Origin: WIDGET_ORIGIN, "x-loadtest-client-ip": ip },
      timeout: "60s",
    },
  );
  const ok = check(res, { "dedup turn: 200": (r) => r.status === 200 });
  errorRate.add(!ok);
  return res;
}

export function sameOrgSamePhone() {
  if (clinicOrgs.length === 0) return;
  const org = clinicOrgs[0];
  sendPhone(org, syntheticIp(__VU), FIXED_PHONE);
  sleep(1);
}

export function crossOrgSamePhone() {
  if (clinicOrgs.length === 0) return;
  const org = clinicOrgs[__VU % clinicOrgs.length];
  sendPhone(org, syntheticIp(1000 + __VU), FIXED_PHONE);
  sleep(1);
}
