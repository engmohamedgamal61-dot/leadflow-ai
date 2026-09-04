-- LeadFlow AI — Phase G: automated follow-up scheduler engine.
--
-- The Phase F `lead_follow_ups` table stores scheduled work but nothing runs
-- it. This adds the minimum for a *reliable* server-side scheduler: an atomic
-- claim, bounded retries, and a delivery channel. Every addition is justified
-- inline. No existing table is restructured; no policy is dropped or weakened.
-- The `processing` / `failed` statuses were added in the previous migration.

-- ── scheduler bookkeeping columns ─────────────────────────────────────────
-- All nullable / defaulted, so Phase F rows are unaffected.
alter table public.lead_follow_ups
  -- retry accounting
  add column attempt_count   integer     not null default 0,
  add column last_attempt_at timestamptz,
  add column last_error      text        check (last_error is null or char_length(last_error) <= 500),
  -- when a retryable failure becomes eligible again (deterministic backoff)
  add column next_attempt_at  timestamptz,
  -- when the row was claimed into `processing` — lets a crashed worker's row
  -- be reclaimed after a timeout instead of being stuck forever
  add column claimed_at       timestamptz,
  -- successful execution time (Phase F only recorded status)
  add column completed_at     timestamptz,
  -- delivery channel: 'internal' today; whatsapp/email/sms are later phases
  -- that only need to set this on creation — the scheduler stays unchanged
  add column channel          text        not null default 'internal';

-- Efficient "find due" scans that skip completed/cancelled/failed rows.
create index lead_follow_ups_due_idx
  on public.lead_follow_ups (scheduled_at)
  where status = 'pending';
create index lead_follow_ups_processing_claimed_idx
  on public.lead_follow_ups (claimed_at)
  where status = 'processing';

-- ── atomic claim (the concurrency mechanism) ─────────────────────────────
-- In `public` so PostgREST can expose it to the RPC call, but locked to
-- `service_role` only (revoked from public / anon / authenticated). It is
-- SECURITY DEFINER, owned by the migration runner (a BYPASSRLS role): the
-- scheduler is a trusted server job with no user session. `search_path = ''`
-- and fully-qualified names, per the Phase A helper convention.
--
-- `for update skip locked` is what makes concurrent workers safe: each worker
-- locks a disjoint set of rows and the others skip them, so a row is claimed
-- at most once per run. Rows stuck in `processing` past `p_stuck_after` (a
-- crashed worker) are reclaimed. Cancelled rows are never `pending`, so they
-- are never claimed.
create or replace function public.claim_due_follow_ups(
  p_limit       integer,
  p_stuck_after interval
)
returns table (
  id              uuid,
  organization_id uuid,
  lead_id         uuid,
  conversation_id uuid,
  note            text,
  source          text,
  channel         text,
  attempt_count   integer,
  org_has_members boolean,
  lead_name       text
)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select f.id
    from public.lead_follow_ups f
    where
      (
        f.status = 'pending'
        and f.scheduled_at <= now()
        and (f.next_attempt_at is null or f.next_attempt_at <= now())
      )
      or (
        f.status = 'processing'
        and f.claimed_at is not null
        and f.claimed_at < now() - p_stuck_after
      )
    order by f.scheduled_at
    limit greatest(coalesce(p_limit, 0), 0)
    for update skip locked
  )
  update public.lead_follow_ups f
  set
    status          = 'processing',
    claimed_at      = now(),
    attempt_count   = f.attempt_count + 1,
    last_attempt_at = now(),
    updated_at      = now()
  from due
  where f.id = due.id
  returning
    f.id,
    f.organization_id,
    f.lead_id,
    f.conversation_id,
    f.note,
    f.source,
    f.channel,
    f.attempt_count,
    exists (
      select 1 from public.organization_members m
      where m.organization_id = f.organization_id
    ) as org_has_members,
    (select l.name from public.leads l where l.id = f.lead_id) as lead_name;
$$;

-- Only the trusted server job (service role) may claim — never the browser.
revoke all on function public.claim_due_follow_ups(integer, interval) from public;
revoke all on function public.claim_due_follow_ups(integer, interval) from anon;
revoke all on function public.claim_due_follow_ups(integer, interval) from authenticated;
grant execute on function public.claim_due_follow_ups(integer, interval) to service_role;
