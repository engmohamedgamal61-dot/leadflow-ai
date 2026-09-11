import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260911120000_rate_limit_cleanup.sql"),
  "utf8",
);

test("cleanup_expired_rate_limits: defined in public, deletes from private.rate_limits", () => {
  assert.match(SQL, /create or replace function public\.cleanup_expired_rate_limits\(/);
  assert.match(SQL, /delete from private\.rate_limits/);
  assert.match(SQL, /returns integer/);
});

test("cleanup_expired_rate_limits is SECURITY DEFINER with a pinned search_path", () => {
  assert.match(SQL, /security definer/);
  assert.match(SQL, /set search_path = ''/);
});

test("cleanup_expired_rate_limits filters on window_start vs a caller-given age", () => {
  assert.match(SQL, /where window_start < now\(\) - make_interval\(secs => greatest\(p_older_than_seconds, 0\)\)/);
  assert.match(SQL, /get diagnostics v_deleted = row_count/);
  assert.match(SQL, /return v_deleted/);
});

test("cleanup_expired_rate_limits is locked to service_role only", () => {
  for (const grantee of ["public", "anon", "authenticated"]) {
    assert.match(
      SQL,
      new RegExp(`revoke all on function public\\.cleanup_expired_rate_limits\\(integer\\) from ${grantee}`),
    );
  }
  assert.match(
    SQL,
    /grant execute on function public\.cleanup_expired_rate_limits\(integer\) to service_role/,
  );
});

test("no existing table restructured, no policy dropped", () => {
  assert.doesNotMatch(SQL, /drop (table|policy|column)/i);
  assert.doesNotMatch(SQL, /alter table private\.rate_limits/);
});
