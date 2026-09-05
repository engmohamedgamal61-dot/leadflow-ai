import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260905190000_revenue_recovery.sql"),
  "utf8",
);

test("lead_recovery_attempts: correct FKs, RLS enabled", () => {
  assert.match(SQL, /create table public\.lead_recovery_attempts/);
  assert.match(SQL, /organization_id\s+uuid not null references public\.organizations/);
  assert.match(SQL, /lead_id\s+uuid not null references public\.leads/);
  assert.match(SQL, /follow_up_id\s+uuid not null references public\.lead_follow_ups/);
  assert.match(SQL, /alter table public\.lead_recovery_attempts enable row level security/);
});

test("priority and resolved_as are constrained to the expected vocabularies", () => {
  assert.match(SQL, /priority\s+text not null check \(priority in \('high', 'medium', 'low'\)\)/);
  assert.match(
    SQL,
    /resolved_as\s+text check \(resolved_as in \('converted', 'no_response'\)\)/,
  );
});

test("duplicate-attempt guard: unique index on lead_id where still open (resolved_at is null)", () => {
  assert.match(
    SQL,
    /create unique index lead_recovery_attempts_open_per_lead\s+on public\.lead_recovery_attempts \(lead_id\)\s+where resolved_at is null/,
  );
});

test("writes are owner/admin/manager/sales; reads are any member; no delete policy", () => {
  assert.match(SQL, /lead_recovery_attempts_select_members[\s\S]*?user_org_ids\(\)/);
  for (const op of ["insert", "update"]) {
    assert.match(
      SQL,
      new RegExp(
        `lead_recovery_attempts_${op}_writers[\\s\\S]*?has_org_role\\(organization_id, array\\['owner', 'admin', 'manager', 'sales'\\]`,
      ),
    );
  }
  assert.doesNotMatch(SQL, /lead_recovery_attempts_delete/);
});

test("no existing table restructured, no policy dropped", () => {
  assert.doesNotMatch(SQL, /drop (table|policy|column)/i);
  assert.doesNotMatch(
    SQL,
    /alter table public\.(leads|lead_events|lead_follow_ups|organizations|organization_members)\b/,
  );
});
