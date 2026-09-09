import { test } from "node:test";
import assert from "node:assert/strict";
import { deliverOne, type FetchLike } from "./delivery.ts";
import { AUTO_DISABLE_AFTER_FAILURES } from "./config.ts";

// ── tiny fake: records the .update() payloads per table ──────────────────
interface Recorded {
  integration_deliveries: Record<string, unknown>[];
  integration_endpoints: Record<string, unknown>[];
}
function fakeDb() {
  const rec: Recorded = { integration_deliveries: [], integration_endpoints: [] };
  const db = {
    from(table: keyof Recorded) {
      return {
        update(payload: Record<string, unknown>) {
          rec[table].push(payload);
          return { eq: async () => ({ data: null, error: null }) };
        },
      };
    },
  };
  return { db: db as never, rec };
}

const NOW = new Date("2026-09-07T12:00:00.000Z");

function delivery(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "d1",
    endpoint_id: "e1",
    event_type: "lead.qualified",
    payload: { id: "evt", type: "lead.qualified" },
    status: "delivering",
    attempt_count: 1,
    max_attempts: 6,
    next_attempt_at: NOW.toISOString(),
    ...over,
  } as never;
}
function endpoint(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "e1",
    url: "https://consumer.example.com/hook",
    secret_encrypted: "x",
    enabled: true,
    consecutive_failures: 0,
    ...over,
  } as never;
}

const fetchStatus = (status: number, body = ""): FetchLike =>
  async () => ({ status, text: async () => body });

test("SSRF guard: a 3xx redirect response is never followed → dead, no body captured", async () => {
  const { db, rec } = fakeDb();
  let followed = false;
  const redirectingFetch: FetchLike = async (_url, init) => {
    assert.equal(init.redirect, "manual", "delivery must not follow redirects");
    // The stub returns the 3xx itself; a real fetch with redirect:"manual"
    // does the same in undici.
    return {
      status: 302,
      text: async () => {
        followed = true;
        return "AWS_SECRET_ACCESS_KEY=…"; // what an SSRF pivot would leak
      },
    };
  };
  const d = await deliverOne(
    db,
    { delivery: delivery(), endpoint: endpoint(), secret: "s" },
    { fetchImpl: redirectingFetch, now: NOW },
  );
  assert.equal(d, "dead");
  assert.equal(rec.integration_deliveries[0].status, "dead");
  assert.equal(followed, false, "response body of a redirect must not be read");
  assert.ok(
    !String(rec.integration_deliveries[0].last_error ?? "").includes("SECRET"),
    "redirect target response must never reach the stored error",
  );
});

test("SSRF guard: an endpoint whose URL is no longer allowed is not contacted → dead", async () => {
  const { db } = fakeDb();
  let called = false;
  const spyFetch: FetchLike = async () => {
    called = true;
    return { status: 200, text: async () => "ok" };
  };
  const d = await deliverOne(
    db,
    {
      delivery: delivery(),
      endpoint: endpoint({ url: "https://169.254.169.254/latest/meta-data" }),
      secret: "s",
    },
    { fetchImpl: spyFetch, now: NOW },
  );
  assert.equal(d, "dead");
  assert.equal(called, false, "a blocked destination must never be fetched");
});

test("SSRF guard: the REAL network path (no fetchImpl) rejects a private literal without connecting", async () => {
  const { db, rec } = fakeDb();
  // No `fetchImpl` → deliverOne runs assertPublicDestination + pinnedPost. A
  // loopback literal is rejected before any socket is opened.
  const d = await deliverOne(
    db,
    { delivery: delivery(), endpoint: endpoint({ url: "https://127.0.0.1/x" }), secret: "s" },
    { now: NOW, timeoutMs: 2000 },
  );
  assert.equal(d, "dead");
  assert.equal(rec.integration_deliveries[0].status, "dead");
  assert.match(String(rec.integration_deliveries[0].last_error), /not allowed/);
});

test("2xx → succeeded; endpoint failure counter reset", async () => {
  const { db, rec } = fakeDb();
  const d = await deliverOne(
    db,
    { delivery: delivery(), endpoint: endpoint({ consecutive_failures: 3 }), secret: "s" },
    { fetchImpl: fetchStatus(200), now: NOW },
  );
  assert.equal(d, "succeeded");
  assert.equal(rec.integration_deliveries[0].status, "succeeded");
  assert.equal(rec.integration_endpoints[0].consecutive_failures, 0);
});

test("500 with attempts left → retry scheduled with backoff", async () => {
  const { db, rec } = fakeDb();
  const d = await deliverOne(
    db,
    { delivery: delivery({ attempt_count: 2 }), endpoint: endpoint(), secret: "s" },
    { fetchImpl: fetchStatus(500, "boom"), now: NOW },
  );
  assert.equal(d, "retry_scheduled");
  assert.equal(rec.integration_deliveries[0].status, "failed");
  assert.equal(
    rec.integration_deliveries[0].next_attempt_at,
    "2026-09-07T12:02:00.000Z",
  );
  assert.equal(rec.integration_endpoints[0].consecutive_failures, 1);
});

test("non-retryable 4xx → dead immediately", async () => {
  const { db, rec } = fakeDb();
  const d = await deliverOne(
    db,
    { delivery: delivery({ attempt_count: 1 }), endpoint: endpoint(), secret: "s" },
    { fetchImpl: fetchStatus(400, "bad"), now: NOW },
  );
  assert.equal(d, "dead");
  assert.equal(rec.integration_deliveries[0].status, "dead");
});

test("429 is retryable", async () => {
  const { db } = fakeDb();
  const d = await deliverOne(
    db,
    { delivery: delivery({ attempt_count: 1 }), endpoint: endpoint(), secret: "s" },
    { fetchImpl: fetchStatus(429), now: NOW },
  );
  assert.equal(d, "retry_scheduled");
});

test("attempts exhausted → dead even for a retryable status", async () => {
  const { db, rec } = fakeDb();
  const d = await deliverOne(
    db,
    { delivery: delivery({ attempt_count: 6, max_attempts: 6 }), endpoint: endpoint(), secret: "s" },
    { fetchImpl: fetchStatus(503), now: NOW },
  );
  assert.equal(d, "dead");
  assert.equal(rec.integration_deliveries[0].status, "dead");
});

test("network error → retryable", async () => {
  const { db } = fakeDb();
  const d = await deliverOne(
    db,
    { delivery: delivery({ attempt_count: 1 }), endpoint: endpoint(), secret: "s" },
    {
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
      now: NOW,
    },
  );
  assert.equal(d, "retry_scheduled");
});

test("auto-disables the endpoint after the failure threshold", async () => {
  const { db, rec } = fakeDb();
  await deliverOne(
    db,
    {
      delivery: delivery({ attempt_count: 1 }),
      endpoint: endpoint({ consecutive_failures: AUTO_DISABLE_AFTER_FAILURES - 1 }),
      secret: "s",
    },
    { fetchImpl: fetchStatus(500), now: NOW },
  );
  assert.equal(rec.integration_endpoints[0].enabled, false);
  assert.equal(rec.integration_endpoints[0].disabled_reason, "auto_disabled_failures");
});

test("a signed request carries the LeadFlow headers", async () => {
  const seen: Record<string, string>[] = [];
  const capture: FetchLike = async (_url, init) => {
    seen.push(init.headers);
    return { status: 200, text: async () => "" };
  };
  const { db } = fakeDb();
  await deliverOne(
    db,
    { delivery: delivery(), endpoint: endpoint(), secret: "whsec_abc" },
    { fetchImpl: capture, now: NOW },
  );
  assert.ok(seen[0]["x-leadflow-signature"].startsWith("sha256="));
  assert.ok(Number(seen[0]["x-leadflow-timestamp"]) > 0);
  assert.equal(seen[0]["x-leadflow-event"], "lead.qualified");
  assert.equal(seen[0]["x-leadflow-delivery"], "d1");
});
