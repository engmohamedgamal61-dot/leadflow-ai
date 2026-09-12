import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260912090000_lead_contact_dedup.sql"),
  "utf8",
);

test("leads gains nullable email_match_key / phone_match_key columns", () => {
  assert.match(SQL, /alter table public\.leads add column email_match_key text/);
  assert.match(SQL, /alter table public\.leads add column phone_match_key text/);
});

test("the actual guarantee: unique indexes on (organization_id, <key>)", () => {
  assert.match(
    SQL,
    /create unique index leads_org_email_match_key_key\s+on public\.leads \(organization_id, email_match_key\)/,
  );
  assert.match(
    SQL,
    /create unique index leads_org_phone_match_key_key\s+on public\.leads \(organization_id, phone_match_key\)/,
  );
});

test("indexes are created AFTER the backfill, so pre-existing duplicate contacts can never break the migration", () => {
  const backfillPos = SQL.indexOf("update public.leads l");
  const indexPos = SQL.indexOf("create unique index leads_org_email_match_key_key");
  assert.ok(backfillPos !== -1 && indexPos !== -1);
  assert.ok(backfillPos < indexPos, "backfill must run before the unique index exists");
});

test("backfill assigns at most one row per (organization_id, key) — ranked by row_number, oldest wins", () => {
  assert.match(SQL, /partition by organization_id, lower\(trim\(email\)\)/);
  assert.match(SQL, /partition by organization_id, right\(regexp_replace\(phone, '\[\^0-9\]', '', 'g'\), 9\)/);
  assert.match(SQL, /order by created_at asc/);
  const rnFilters = SQL.match(/r\.rn = 1/g) ?? [];
  assert.equal(rnFilters.length, 2, "both backfills must filter to exactly one row per group");
});

test("no existing table restructured, no policy dropped, no column removed", () => {
  assert.doesNotMatch(SQL, /drop (table|policy|column)/i);
  assert.doesNotMatch(SQL, /alter table public\.leads (alter|drop)/i);
});
