import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "supabase", "migrations");
const values = readFileSync(
  join(dir, "20260904160000_follow_up_status_values.sql"),
  "utf8",
);
const scheduler = readFileSync(
  join(dir, "20260904160100_follow_up_scheduler.sql"),
  "utf8",
);

test("processing + failed enum values are added in their own migration", () => {
  assert.match(values, /add value if not exists 'processing'/);
  assert.match(values, /add value if not exists 'failed'/);
  // nothing that would *use* the new values in the same transaction
  assert.doesNotMatch(values, /create index|create or replace function|update .*status/i);
});

test("scheduler bookkeeping columns are added, all nullable/defaulted", () => {
  for (const col of [
    "attempt_count",
    "last_attempt_at",
    "last_error",
    "next_attempt_at",
    "claimed_at",
    "completed_at",
    "channel",
  ]) {
    assert.match(scheduler, new RegExp(`add column\\s+${col}\\b`), `missing ${col}`);
  }
  assert.match(scheduler, /attempt_count\s+integer\s+not null default 0/);
  assert.match(scheduler, /channel\s+text\s+not null default 'internal'/);
});

test("claim function uses FOR UPDATE SKIP LOCKED and is SECURITY DEFINER", () => {
  assert.match(scheduler, /create or replace function public\.claim_due_follow_ups/);
  assert.match(scheduler, /for update skip locked/i);
  assert.match(scheduler, /security definer/);
  assert.match(scheduler, /set search_path = ''/);
  assert.match(scheduler, /set\s+status\s+=\s+'processing'/);
  assert.match(scheduler, /attempt_count\s+=\s+f\.attempt_count \+ 1/);
});

test("claim only picks pending (or stuck processing) rows — never cancelled", () => {
  assert.match(scheduler, /f\.status = 'pending'\s*and f\.scheduled_at <= now\(\)/);
  assert.match(scheduler, /f\.status = 'processing'[\s\S]*?claimed_at < now\(\) - p_stuck_after/);
  assert.doesNotMatch(scheduler, /status = 'cancelled'/);
});

test("claim function is service-role only", () => {
  assert.match(scheduler, /revoke all on function public\.claim_due_follow_ups\(integer, interval\) from public/);
  assert.match(scheduler, /revoke all on function public\.claim_due_follow_ups\(integer, interval\) from anon/);
  assert.match(scheduler, /revoke all on function public\.claim_due_follow_ups\(integer, interval\) from authenticated/);
  assert.match(scheduler, /grant execute on function public\.claim_due_follow_ups\(integer, interval\) to service_role/);
});

test("no existing table restructured, no policy dropped, indexes are partial", () => {
  assert.doesNotMatch(scheduler, /drop (table|policy|column)/i);
  assert.doesNotMatch(scheduler, /alter table public\.(leads|conversations|messages|lead_events|organizations)\b/);
  assert.match(scheduler, /create index lead_follow_ups_due_idx[\s\S]*?where status = 'pending'/);
});
