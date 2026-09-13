-- LeadFlow AI — Enterprise Operations Readiness: backlog/staleness summaries
-- for the follow-up scheduler, the Integration Hub worker, and rate-limit
-- cleanup, plus the safe counts an ops summary route can expose.
--
-- No new tables. Every signal below is derived from tables/columns that
-- already exist (`lead_follow_ups`, `integration_event_outbox`,
-- `integration_deliveries`, `private.rate_limits`) — the scheduler/worker
-- bookkeeping columns already record everything needed to answer "is this
-- job falling behind?" without a dedicated "cron run log" table.
--
-- Same shape as every prior `service_role`-only summary function
-- (`org_ai_usage_totals`, `hit_rate_limit`, `cleanup_expired_rate_limits`):
-- SECURITY DEFINER, `search_path = ''`, revoked from public/anon/authenticated,
-- granted only to `service_role`. Each returns SAFE AGGREGATE NUMBERS ONLY —
-- no lead name, note, payload, URL, or org name ever leaves these functions,
-- deliberately narrower than a raw table grant would be.

-- ── 1. follow-up scheduler backlog ─────────────────────────────────────────
-- `pending_due`     — due now, not yet claimed by a worker.
-- `stuck_processing`— claimed but the worker never finished within
--                     `p_stuck_after` (a crashed/killed worker) — these are
--                     the rows `claim_due_follow_ups` will itself reclaim on
--                     the next run, so a nonzero count here that doesn't
--                     shrink between polls means the cron isn't running.
-- `failed`          — exhausted retries (`follow_up_status = 'failed'`),
--                     i.e. repeated-failure count, all-time.
-- `oldest_due_seconds` — age of the oldest still-`pending`-and-due row; the
--                     load-bearing "cron has not run for too long" signal —
--                     a healthy 5-minute cron never lets this exceed a few
--                     minutes.
create or replace function public.follow_up_backlog_summary(
  p_stuck_after interval default '15 minutes'
)
returns table (
  pending_due        bigint,
  stuck_processing   bigint,
  failed             bigint,
  oldest_due_seconds double precision
)
language sql
security definer
set search_path = ''
as $$
  select
    count(*) filter (
      where f.status = 'pending' and f.scheduled_at <= now()
    ) as pending_due,
    count(*) filter (
      where f.status = 'processing' and f.claimed_at < now() - p_stuck_after
    ) as stuck_processing,
    count(*) filter (where f.status = 'failed') as failed,
    extract(epoch from (
      now() - min(f.scheduled_at) filter (
        where f.status = 'pending' and f.scheduled_at <= now()
      )
    )) as oldest_due_seconds
  from public.lead_follow_ups f;
$$;

revoke all on function public.follow_up_backlog_summary(interval) from public;
revoke all on function public.follow_up_backlog_summary(interval) from anon;
revoke all on function public.follow_up_backlog_summary(interval) from authenticated;
grant execute on function public.follow_up_backlog_summary(interval) to service_role;

-- ── 2. Integration Hub backlog ──────────────────────────────────────────────
-- `pending_fanout`     — outbox events the worker hasn't fanned into
--                        per-endpoint deliveries yet.
-- `pending_deliveries` — deliveries due to be attempted (`pending`/`failed`
--                        and `next_attempt_at <= now()`).
-- `stuck_delivering`   — claimed (`delivering`) past `p_stuck_after` — a
--                        crashed worker's rows, reclaimed on the next run
--                        (`claim_integration_deliveries`); persistently
--                        nonzero means the cron isn't running.
-- `dead`               — terminal failures (max attempts or a non-retryable
--                        4xx) — the repeated-failure signal.
-- `oldest_pending_seconds` — age of the oldest still-due delivery.
create or replace function public.integration_hub_backlog_summary(
  p_stuck_after interval default '5 minutes'
)
returns table (
  pending_fanout          bigint,
  pending_deliveries      bigint,
  stuck_delivering        bigint,
  dead                    bigint,
  oldest_pending_seconds  double precision
)
language sql
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.integration_event_outbox where fanned_out_at is null) as pending_fanout,
    (select count(*) from public.integration_deliveries
       where status in ('pending','failed') and next_attempt_at <= now()) as pending_deliveries,
    (select count(*) from public.integration_deliveries
       where status = 'delivering' and claimed_at < now() - p_stuck_after) as stuck_delivering,
    (select count(*) from public.integration_deliveries where status = 'dead') as dead,
    (select extract(epoch from (now() - min(next_attempt_at)))
       from public.integration_deliveries
       where status in ('pending','failed') and next_attempt_at <= now()) as oldest_pending_seconds;
$$;

revoke all on function public.integration_hub_backlog_summary(interval) from public;
revoke all on function public.integration_hub_backlog_summary(interval) from anon;
revoke all on function public.integration_hub_backlog_summary(interval) from authenticated;
grant execute on function public.integration_hub_backlog_summary(interval) to service_role;

-- ── 3. Rate-limit cleanup staleness ─────────────────────────────────────────
-- Not a due-work queue like the two above — `private.rate_limits` has no
-- "backlog," only rows the daily cleanup cron hasn't gotten to yet. A count
-- of rows well past the cron's own retention window is the same kind of
-- staleness signal: growing (or nonzero right after the cron should have
-- run) means the cron isn't running. Counts only — keys (`bucket:id`
-- strings) are never returned.
create or replace function public.rate_limit_backlog_summary(
  p_stale_after_seconds integer default 172800 -- 48h: 2x the cron's own 24h default retention
)
returns table (
  stale_count bigint
)
language sql
security definer
set search_path = ''
as $$
  select count(*)
  from private.rate_limits
  where window_start < now() - make_interval(secs => greatest(p_stale_after_seconds, 0));
$$;

revoke all on function public.rate_limit_backlog_summary(integer) from public;
revoke all on function public.rate_limit_backlog_summary(integer) from anon;
revoke all on function public.rate_limit_backlog_summary(integer) from authenticated;
grant execute on function public.rate_limit_backlog_summary(integer) to service_role;
