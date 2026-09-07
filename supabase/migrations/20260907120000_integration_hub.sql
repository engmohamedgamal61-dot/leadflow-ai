-- LeadFlow AI — Phase N: generic Integration Hub (outbound webhooks + inbound actions).
--
-- A provider-agnostic webhook layer. n8n is the first documented consumer but
-- nothing here depends on it — an endpoint is just a signed HTTPS URL plus a
-- list of LeadFlow domain events it wants. CRM / Slack / Sheets / anything that
-- speaks HTTP is the same shape.
--
-- Four tables + a transactional outbox fed by DB triggers on the EXISTING
-- domain-event stream (`lead_events`, `lead_recovery_attempts`). No existing
-- table is restructured, no policy dropped, and NO existing write path changes:
-- the triggers are the only new behaviour and they are additive (an insert into
-- a new table, best-effort, never raising).
--
--  1. `integration_endpoints`        — per-org signed webhook endpoints.
--  2. `integration_event_outbox`     — domain events queued for fan-out (trigger-fed).
--  3. `integration_deliveries`       — one attempt-tracked row per (endpoint, event).
--  4. `integration_inbound_actions`  — audit + idempotency for the inbound action API.
--
-- Secrets: the per-endpoint HMAC signing secret is stored AES-256-GCM encrypted
-- (src/lib/integrations/secret.ts) and column-revoked from `authenticated`, the
-- same pattern as the WhatsApp access token and the Calendar OAuth tokens. Only
-- the trusted server boundary (the delivery worker, the inbound route) decrypts
-- it. The dashboard only ever sees a non-sensitive hint (last 6 chars).

-- ── 1. integration_endpoints ─────────────────────────────────────────────

create table public.integration_endpoints (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  name                  text not null check (char_length(name) between 1 and 80),
  -- Destination URL. Structural check only; the app (src/lib/integrations/
  -- validation.ts) enforces https + blocks private/loopback ranges (SSRF).
  url                   text not null
                          check (url ~ '^https?://' and char_length(url) <= 2048),
  -- AES-256-GCM ciphertext of the signing secret. Server-only — never selectable
  -- by `authenticated` (column revoke below).
  secret_encrypted      text not null,
  -- Safe-to-display tail of the secret, e.g. 'whsec_…a1b2c3'. Never the secret.
  secret_hint           text not null,
  secret_rotated_at     timestamptz,
  enabled               boolean not null default true,
  -- Canonical LeadFlow event names (src/lib/integrations/events.ts). Validated
  -- in app code against the allowlist; an unknown name simply never matches.
  subscribed_events     text[] not null default '{}'::text[],
  description           text check (description is null or char_length(description) <= 300),
  -- Health / status, maintained by the delivery worker.
  consecutive_failures  integer not null default 0,
  last_success_at       timestamptz,
  last_failure_at       timestamptz,
  last_error            text check (last_error is null or char_length(last_error) <= 500),
  -- Set by the worker when consecutive_failures crosses the auto-disable
  -- threshold, so the UI can explain why a still-configured endpoint went quiet.
  disabled_reason       text check (disabled_reason is null or char_length(disabled_reason) <= 120),
  created_by            uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger integration_endpoints_set_updated_at
  before update on public.integration_endpoints
  for each row execute function private.set_updated_at();

create index integration_endpoints_org_idx
  on public.integration_endpoints (organization_id);

alter table public.integration_endpoints enable row level security;

-- anon: nothing. authenticated: every column EXCEPT the encrypted secret.
revoke all on public.integration_endpoints from anon;
revoke select on public.integration_endpoints from authenticated;
grant select
  (id, organization_id, name, url, secret_hint, secret_rotated_at, enabled,
   subscribed_events, description, consecutive_failures, last_success_at,
   last_failure_at, last_error, disabled_reason, created_by, created_at, updated_at)
  on public.integration_endpoints to authenticated;
grant insert, update, delete on public.integration_endpoints to authenticated;

-- Read: any member. Write: owner/admin only (an endpoint holds a signing
-- secret — same set as organization_configs / whatsapp_connections).
create policy integration_endpoints_select_members
  on public.integration_endpoints for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create policy integration_endpoints_insert_admins
  on public.integration_endpoints for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner', 'admin']));

create policy integration_endpoints_update_admins
  on public.integration_endpoints for update to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']))
  with check (private.has_org_role(organization_id, array['owner', 'admin']));

create policy integration_endpoints_delete_admins
  on public.integration_endpoints for delete to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']));

-- ── 2. integration_event_outbox (transactional outbox) ───────────────────
-- Written only by the DB triggers below; drained only by the delivery worker
-- (service role). The dashboard never reads raw outbox rows — the
-- user-facing history is `integration_deliveries`.

create table public.integration_event_outbox (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  -- Canonical event name, e.g. 'lead.created'.
  event_type       text not null,
  lead_id          uuid references public.leads (id) on delete set null,
  -- Event-specific extras copied from the source row (e.g. {from,to} for a
  -- status change). The worker enriches with a lead snapshot at fan-out time.
  payload          jsonb not null default '{}'::jsonb,
  occurred_at      timestamptz not null,
  fanned_out_at    timestamptz,
  created_at       timestamptz not null default now()
);

create index integration_event_outbox_pending_idx
  on public.integration_event_outbox (created_at)
  where fanned_out_at is null;

alter table public.integration_event_outbox enable row level security;
revoke all on public.integration_event_outbox from anon;
revoke all on public.integration_event_outbox from authenticated;
grant select, insert, update on public.integration_event_outbox to service_role;

-- ── 3. integration_deliveries ────────────────────────────────────────────
-- One row per (endpoint, outbox event). Attempt-tracked with exponential
-- backoff (src/lib/integrations/config.ts). Members can read their delivery
-- history; only the worker + owner/admin server actions (via service role)
-- write.

create table public.integration_deliveries (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  endpoint_id        uuid not null references public.integration_endpoints (id) on delete cascade,
  outbox_event_id    uuid references public.integration_event_outbox (id) on delete set null,
  event_type         text not null,
  -- The exact JSON body that is / was signed and sent (snapshot).
  payload            jsonb not null,
  -- pending | delivering | succeeded | failed | dead
  --   failed = retryable, will try again after next_attempt_at
  --   dead   = terminal (max attempts, or a non-retryable 4xx)
  status             text not null default 'pending'
                       check (status in ('pending','delivering','succeeded','failed','dead')),
  attempt_count      integer not null default 0,
  max_attempts       integer not null default 6,
  next_attempt_at    timestamptz not null default now(),
  claimed_at         timestamptz,
  last_status_code   integer,
  last_error         text check (last_error is null or char_length(last_error) <= 500),
  last_attempt_at    timestamptz,
  -- How long the last HTTP attempt took, for the health view.
  last_duration_ms   integer,
  delivered_at       timestamptz,
  -- 'test' for a "send test webhook" delivery, else 'event'.
  kind               text not null default 'event' check (kind in ('event','test')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger integration_deliveries_set_updated_at
  before update on public.integration_deliveries
  for each row execute function private.set_updated_at();

-- Idempotent fan-out: one delivery per (endpoint, outbox event). A full (not
-- partial) unique index so PostgREST's `on_conflict=` can infer it. Test
-- deliveries carry a NULL `outbox_event_id`; standard NULL-distinct semantics
-- let any number of them coexist, while real fan-out rows dedupe.
create unique index integration_deliveries_endpoint_event_key
  on public.integration_deliveries (endpoint_id, outbox_event_id);

create index integration_deliveries_due_idx
  on public.integration_deliveries (next_attempt_at)
  where status in ('pending','failed');
create index integration_deliveries_claimed_idx
  on public.integration_deliveries (claimed_at)
  where status = 'delivering';
create index integration_deliveries_endpoint_idx
  on public.integration_deliveries (endpoint_id, created_at desc);

alter table public.integration_deliveries enable row level security;
revoke all on public.integration_deliveries from anon;
-- Read for members (the history table); writes are worker/service-role only.
grant select on public.integration_deliveries to authenticated;
grant select, insert, update on public.integration_deliveries to service_role;

create policy integration_deliveries_select_members
  on public.integration_deliveries for select to authenticated
  using (organization_id in (select private.user_org_ids()));

-- ── 4. integration_inbound_actions (audit + idempotency) ─────────────────
-- Every call to the inbound action API lands here: accepted, rejected,
-- duplicate or failed. `(endpoint_id, idempotency_key)` is unique so a retry
-- returns the first outcome instead of running the action twice.

create table public.integration_inbound_actions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  endpoint_id       uuid not null references public.integration_endpoints (id) on delete cascade,
  idempotency_key   text not null check (char_length(idempotency_key) between 1 and 200),
  action            text not null,
  lead_id           uuid references public.leads (id) on delete set null,
  -- Redacted request shape (never a signature, never a secret).
  request_summary   jsonb not null default '{}'::jsonb,
  -- accepted | rejected | duplicate | failed
  status            text not null
                      check (status in ('accepted','rejected','duplicate','failed')),
  result_summary    jsonb,
  error_code        text check (error_code is null or char_length(error_code) <= 120),
  received_at       timestamptz not null default now()
);

create unique index integration_inbound_actions_idem_key
  on public.integration_inbound_actions (endpoint_id, idempotency_key);
create index integration_inbound_actions_org_idx
  on public.integration_inbound_actions (organization_id, received_at desc);

alter table public.integration_inbound_actions enable row level security;
revoke all on public.integration_inbound_actions from anon;
grant select on public.integration_inbound_actions to authenticated;
grant select, insert, update on public.integration_inbound_actions to service_role;

create policy integration_inbound_actions_select_members
  on public.integration_inbound_actions for select to authenticated
  using (organization_id in (select private.user_org_ids()));

-- ── 5. outbox triggers on the existing domain-event streams ──────────────
-- These map an internal event to its canonical name and enqueue an outbox
-- row — but ONLY when the org has at least one enabled endpoint subscribed to
-- that event, so the outbox stays empty for the vast majority of orgs. Best
-- effort by construction: an AFTER trigger inserting into a fresh table, and
-- `ON CONFLICT DO NOTHING`-style source inserts mean a de-duplicated domain
-- event never re-enqueues.

create or replace function private.integration_enqueue_event(
  p_org_id      uuid,
  p_event_type  text,
  p_lead_id     uuid,
  p_payload     jsonb,
  p_occurred_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.integration_endpoints e
    where e.organization_id = p_org_id
      and e.enabled
      and p_event_type = any(e.subscribed_events)
  ) then
    return;
  end if;

  insert into public.integration_event_outbox
    (organization_id, event_type, lead_id, payload, occurred_at)
  values
    (p_org_id, p_event_type, p_lead_id, coalesce(p_payload, '{}'::jsonb), p_occurred_at);
end;
$$;

create or replace function private.integration_outbox_from_lead_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_canonical text;
begin
  v_canonical := case new.event_type
    when 'lead_created'             then 'lead.created'
    when 'lead_qualified'           then 'lead.qualified'
    when 'status_changed'           then 'lead.status_changed'
    when 'appointment_booked'       then 'appointment.booked'
    when 'appointment_rescheduled'  then 'appointment.rescheduled'
    when 'appointment_cancelled'    then 'appointment.cancelled'
    when 'follow_up_executed'       then 'follow_up.executed'
    when 'human_handoff_requested'  then 'handoff.requested'
    when 'recovery_attempt_started' then 'recovery.started'
    else null
  end;

  if v_canonical is not null then
    perform private.integration_enqueue_event(
      new.organization_id, v_canonical, new.lead_id,
      coalesce(new.metadata, '{}'::jsonb), new.created_at);
  end if;
  return null;
end;
$$;

create trigger lead_events_integration_outbox
  after insert on public.lead_events
  for each row execute function private.integration_outbox_from_lead_event();

-- Recovery resolution has no `lead_events` row today (it is written back
-- lazily from a read query). Source `recovery.resolved` straight from the
-- state transition so it fires no matter which code path resolves the attempt.
create or replace function private.integration_outbox_from_recovery_resolve()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.resolved_at is null and new.resolved_at is not null then
    perform private.integration_enqueue_event(
      new.organization_id, 'recovery.resolved', new.lead_id,
      jsonb_build_object('resolvedAs', new.resolved_as, 'attemptId', new.id),
      new.resolved_at);
  end if;
  return null;
end;
$$;

create trigger lead_recovery_attempts_integration_outbox
  after update on public.lead_recovery_attempts
  for each row execute function private.integration_outbox_from_recovery_resolve();

-- ── 6. atomic delivery claim (service-role only) ────────────────────────
-- Same concurrency mechanism as `claim_due_follow_ups`: `FOR UPDATE SKIP
-- LOCKED` so parallel workers take disjoint rows. Claims due `pending`/`failed`
-- rows and reclaims `delivering` rows stuck past `p_stuck_after` (crashed
-- worker). Marks them `delivering` and bumps the attempt counter.

create or replace function public.claim_integration_deliveries(
  p_limit       integer,
  p_stuck_after interval
)
returns setof public.integration_deliveries
language sql
security definer
set search_path = ''
as $$
  with due as (
    select d.id
    from public.integration_deliveries d
    where
      (
        d.status in ('pending', 'failed')
        and d.next_attempt_at <= now()
      )
      or (
        d.status = 'delivering'
        and d.claimed_at is not null
        and d.claimed_at < now() - p_stuck_after
      )
    order by d.next_attempt_at
    limit greatest(coalesce(p_limit, 0), 0)
    for update skip locked
  )
  update public.integration_deliveries d
  set
    status         = 'delivering',
    claimed_at     = now(),
    attempt_count  = d.attempt_count + 1,
    last_attempt_at = now(),
    updated_at     = now()
  from due
  where d.id = due.id
  returning d.*;
$$;

revoke all on function public.claim_integration_deliveries(integer, interval) from public;
revoke all on function public.claim_integration_deliveries(integer, interval) from anon;
revoke all on function public.claim_integration_deliveries(integer, interval) from authenticated;
grant execute on function public.claim_integration_deliveries(integer, interval) to service_role;
