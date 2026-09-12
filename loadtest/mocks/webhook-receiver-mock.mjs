#!/usr/bin/env node
/**
 * Deterministic webhook receiver for Integration Hub load testing (Scenario
 * F). Not application code. The Integration Hub worker (src/lib/integrations/
 * worker.ts + delivery.ts) POSTs signed event envelopes here exactly like it
 * would to a real customer endpoint.
 *
 * Control: POST /_control/scenario { "scenario": "ok" | "fail_500" | "timeout" }
 * State:   GET  /_control/state -> { scenario, received, byPath }
 */
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_WEBHOOK_PORT ?? 9102);
const TIMEOUT_HOLD_MS = Number(process.env.MOCK_WEBHOOK_TIMEOUT_HOLD_MS ?? 15_000);

let scenario = "ok";
let received = 0;
const byPath = {};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "POST" && url.pathname === "/_control/scenario") {
    const body = await readBody(req);
    const { scenario: next } = JSON.parse(body || "{}");
    if (!["ok", "fail_500", "timeout"].includes(next)) {
      res.writeHead(400).end(JSON.stringify({ error: "unknown scenario" }));
      return;
    }
    scenario = next;
    received = 0;
    byPath[Object.keys(byPath)[0]] = undefined;
    for (const k of Object.keys(byPath)) delete byPath[k];
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ scenario }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/_control/state") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({ scenario, received, byPath }),
    );
    return;
  }

  // Any other path is a webhook delivery target.
  await readBody(req);
  received += 1;
  byPath[url.pathname] = (byPath[url.pathname] ?? 0) + 1;

  if (scenario === "timeout") {
    setTimeout(() => {
      if (!res.headersSent) res.writeHead(200).end("{}");
    }, TIMEOUT_HOLD_MS);
    return;
  }
  if (scenario === "fail_500") {
    res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "mock failure" }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
});

server.listen(PORT, () => {
  console.log(`[webhook-receiver-mock] listening on http://localhost:${PORT}`);
});
