-- LeadFlow AI — security audit hardening.
--
-- Defence-in-depth only. No table is restructured, no policy is dropped or
-- weakened, no existing behaviour changes.
--
--   1. Enable RLS (deny-all) on `private.rate_limits`. It is already
--      unreachable via PostgREST (the `private` schema is not exposed) and
--      `authenticated` / `anon` hold no grant on it, but a table that feeds a
--      security control should still be default-deny at the row level. The
--      `public.hit_rate_limit` SECURITY DEFINER function is unaffected — it
--      runs as the table owner, which bypasses RLS.
--
--   2. Belt-and-braces re-REVOKE of every sensitive RPC from anon/authenticated
--      (already revoked in their original migrations; harmless to repeat, and
--      it documents the intended surface in one place after the audit).

alter table private.rate_limits enable row level security;
-- No policy → no role can select/insert/update/delete a row directly.
revoke all on private.rate_limits from anon;
revoke all on private.rate_limits from authenticated;

-- Re-assert: these run only from the trusted server (service role).
revoke all on function public.hit_rate_limit(text, integer, integer) from anon, authenticated;
revoke all on function public.claim_due_follow_ups(integer, interval) from anon, authenticated;
revoke all on function public.claim_integration_deliveries(integer, interval) from anon, authenticated;
revoke all on function public.org_ai_usage_totals(uuid, timestamptz, timestamptz) from anon, authenticated;
