import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAllowedOrigins, resolveOrgByWidgetKey, WidgetLookupError } from "./widget.ts";

// Minimal fake matching the one query chain resolveOrgByWidgetKey uses:
// db.from(table).select(...).eq(col, val).maybeSingle() -> {data, error}.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeDb(result: { data: unknown; error: unknown }): any {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => result,
        }),
      }),
    }),
  };
}

const VALID_KEY = "11111111-1111-1111-1111-111111111111";

test("parseAllowedOrigins: normalizes to origins, dedupes, rejects junk", () => {
  const r = parseAllowedOrigins(
    "https://acme.com/contact\nhttps://acme.com\nhttp://localhost:5173\nnot a url",
  );
  assert.deepEqual(r.origins, ["https://acme.com", "http://localhost:5173"]);
  assert.deepEqual(r.invalid, ["not a url"]);
  assert.equal(r.ok, false);
});

test("parseAllowedOrigins: empty input is valid and empty", () => {
  const r = parseAllowedOrigins("");
  assert.deepEqual(r.origins, []);
  assert.equal(r.ok, true);
});

test("parseAllowedOrigins: rejects non-http(s) schemes", () => {
  const r = parseAllowedOrigins("ftp://acme.com\njavascript:alert(1)");
  assert.equal(r.origins.length, 0);
  assert.equal(r.ok, false);
});

test("parseAllowedOrigins: caps the list", () => {
  const many = Array.from({ length: 40 }, (_, i) => `https://s${i}.example.com`).join("\n");
  assert.equal(parseAllowedOrigins(many).origins.length, 20);
});

// ── resolveOrgByWidgetKey: outage vs. legitimate not-found (Supabase-outage
//    hardening) — a genuine query error must never be silently conflated
//    with "no such widget key". ───────────────────────────────────────────

test("resolveOrgByWidgetKey: a non-UUID key returns null without even querying", async () => {
  const db = fakeDb({ data: null, error: new Error("should never be reached") });
  assert.equal(await resolveOrgByWidgetKey(db, "not-a-uuid"), null);
});

test("resolveOrgByWidgetKey: unknown key (no row, no error) returns null", async () => {
  const db = fakeDb({ data: null, error: null });
  assert.equal(await resolveOrgByWidgetKey(db, VALID_KEY), null);
});

test("resolveOrgByWidgetKey: disabled widget returns null", async () => {
  const db = fakeDb({
    data: {
      enabled: false,
      allowed_origins: [],
      organizations: { id: "org-1", name: "Acme", industry_template_id: "real-estate", status: "active" },
    },
    error: null,
  });
  assert.equal(await resolveOrgByWidgetKey(db, VALID_KEY), null);
});

test("resolveOrgByWidgetKey: suspended organization returns null", async () => {
  const db = fakeDb({
    data: {
      enabled: true,
      allowed_origins: [],
      organizations: { id: "org-1", name: "Acme", industry_template_id: "real-estate", status: "suspended" },
    },
    error: null,
  });
  assert.equal(await resolveOrgByWidgetKey(db, VALID_KEY), null);
});

test("resolveOrgByWidgetKey: a genuine query error throws WidgetLookupError, not null", async () => {
  const queryError = { code: "PGRST000", message: "fetch failed" };
  const db = fakeDb({ data: null, error: queryError });
  await assert.rejects(
    () => resolveOrgByWidgetKey(db, VALID_KEY),
    (err: unknown) => {
      assert.ok(err instanceof WidgetLookupError);
      assert.equal(err.cause, queryError);
      return true;
    },
  );
});

test("resolveOrgByWidgetKey: enabled + active org resolves normally", async () => {
  const db = fakeDb({
    data: {
      enabled: true,
      allowed_origins: ["https://acme.com"],
      organizations: { id: "org-1", name: "Acme", industry_template_id: "real-estate", status: "active" },
    },
    error: null,
  });
  const result = await resolveOrgByWidgetKey(db, VALID_KEY);
  assert.deepEqual(result, {
    organizationId: "org-1",
    organizationName: "Acme",
    industryTemplateId: "real-estate",
    allowedOrigins: ["https://acme.com"],
  });
});
