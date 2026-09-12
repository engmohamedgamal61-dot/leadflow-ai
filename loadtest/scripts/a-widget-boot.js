// Scenario A — Widget boot: GET /widget.js (loader), GET /embed/<key> (resolves
// widget key -> org -> presentation, SSR page load). No Anthropic call at all
// — this is the "non-LLM request" latency class.
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";
import { APP_URL, pickOrg } from "./lib/config.js";

export const widgetJsDuration = new Trend("widget_js_duration", true);
export const embedPageDuration = new Trend("embed_page_duration", true);
export const errorRate = new Rate("scenario_errors");

export const options = {
  scenarios: {
    widget_boot: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 10),
      duration: __ENV.DURATION || "30s",
    },
  },
  thresholds: {
    scenario_errors: ["rate<0.01"],
  },
};

export default function () {
  const org = pickOrg(__VU);

  const js = http.get(`${APP_URL}/widget.js`);
  widgetJsDuration.add(js.timings.duration);
  const jsOk = check(js, { "widget.js 200": (r) => r.status === 200 });
  errorRate.add(!jsOk);

  const embed = http.get(`${APP_URL}/embed/${org.widgetKey}`);
  embedPageDuration.add(embed.timings.duration);
  const embedOk = check(embed, {
    "embed page 200": (r) => r.status === 200,
    "embed page not empty": (r) => r.body.length > 500,
  });
  errorRate.add(!embedOk);

  sleep(1);
}
