// Scenario B — Widget chat: the full /api/chat path — mocked streamed AI
// reply, mocked extraction, persistence, lead create then update (2 turns per
// VU iteration, same conversationId). This is the "LLM streaming request"
// latency class.
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";
import { APP_URL, WIDGET_ORIGIN, pickOrg, syntheticIp } from "./lib/config.js";

export const chatTurnDuration = new Trend("chat_turn_duration", true);
export const leadCreateDuration = new Trend("chat_lead_create_duration", true);
export const leadUpdateDuration = new Trend("chat_lead_update_duration", true);
export const errorRate = new Rate("scenario_errors");
export const timeoutRate = new Rate("scenario_timeouts");

export const options = {
  scenarios: {
    widget_chat: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 10),
      duration: __ENV.DURATION || "30s",
    },
  },
  thresholds: {
    scenario_errors: ["rate<0.02"],
  },
};

function chatTurn(org, ip, messages, conversationId) {
  const res = http.post(
    `${APP_URL}/api/chat`,
    JSON.stringify({
      messages,
      widgetKey: org.widgetKey,
      pageOrigin: WIDGET_ORIGIN,
      conversationId: conversationId || undefined,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        Origin: WIDGET_ORIGIN,
        "x-loadtest-client-ip": ip,
      },
      timeout: "60s",
    },
  );
  return res;
}

export default function () {
  const org = pickOrg(__VU);
  const ip = syntheticIp(__VU);

  // Turn 1: creates the lead.
  const t1Start = Date.now();
  const turn1 = chatTurn(org, ip, [{ role: "user", content: "Hi, I'm interested in a property" }], null);
  const t1Dur = Date.now() - t1Start;
  chatTurnDuration.add(t1Dur);
  leadCreateDuration.add(t1Dur);

  const ok1 = check(turn1, {
    "turn1: 200": (r) => r.status === 200,
    "turn1: has lead delimiter": (r) => r.body.includes("\n---LEAD---\n") || r.body.includes('"conversationId"'),
  });
  errorRate.add(!ok1);
  timeoutRate.add(turn1.status === 0);
  if (!ok1) {
    sleep(1);
    return;
  }

  let conversationId = null;
  const marker = '"conversationId":"';
  const idx = turn1.body.indexOf(marker);
  if (idx !== -1) {
    conversationId = turn1.body.slice(idx + marker.length, turn1.body.indexOf('"', idx + marker.length));
  }

  sleep(0.5);

  // Turn 2: same conversation — updates the same lead/conversation.
  const t2Start = Date.now();
  const turn2 = chatTurn(
    org,
    ip,
    [
      { role: "user", content: "Hi, I'm interested in a property" },
      { role: "assistant", content: "Sure — what's your budget and preferred area?" },
      { role: "user", content: "Around 800k, in Riyadh" },
    ],
    conversationId,
  );
  const t2Dur = Date.now() - t2Start;
  chatTurnDuration.add(t2Dur);
  leadUpdateDuration.add(t2Dur);

  const ok2 = check(turn2, { "turn2: 200": (r) => r.status === 200 });
  errorRate.add(!ok2);
  timeoutRate.add(turn2.status === 0);

  sleep(1);
}
