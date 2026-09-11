-- LeadFlow AI — Rate-limit counter cleanup.
--
-- `private.rate_limits` (Pilot Hardening, 20260905200000_pilot_hardening.sql)
-- has no expiry: `hit_rate_limit` inserts or updates a row keyed by
-- `bucket:id` and the row lives forever, even long after the caller stops
-- being rate-limited. This adds one function to delete rows whose window has
-- been stale for a caller-given duration — pure garbage collection, not a
-- correctness dependency of `hit_rate_limit` itself (its UPSERT re-creates any
-- deleted key on the very next hit). Same SECURITY DEFINER / service_role-only
-- shape as `hit_rate_limit`.
--
-- No safety floor is enforced in SQL — the only application caller
-- (`src/lib/security/rate-limit-cleanup.ts`, driving the
-- `/api/internal/rate-limits/cleanup` cron route) is responsible for a
-- conservative retention window (default 24h, floored at 1h — comfortably
-- above every current rule's `windowSeconds`, the longest of which is 3600s
-- for `chat:org`, so an active window is never touched). Tests exercise the
-- raw function with a short window directly, the way `hit_rate_limit`'s own
-- tests use a short `p_window_seconds`.

create or replace function public.cleanup_expired_rate_limits(
  p_older_than_seconds integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from private.rate_limits
  where window_start < now() - make_interval(secs => greatest(p_older_than_seconds, 0));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_expired_rate_limits(integer) from public;
revoke all on function public.cleanup_expired_rate_limits(integer) from anon;
revoke all on function public.cleanup_expired_rate_limits(integer) from authenticated;
grant execute on function public.cleanup_expired_rate_limits(integer) to service_role;
