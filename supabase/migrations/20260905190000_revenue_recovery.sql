-- LeadFlow AI — Phase L: Revenue Recovery.
--
-- Tracks a "recovery attempt" — a deliberate re-engagement outreach for a
-- lost/inactive lead — as a thin record on top of the EXISTING follow-up
-- scheduler/channel architecture (Phase F/G/H). Starting a recovery attempt
-- creates a normal `lead_follow_ups` row (source='recovery'); this table adds
-- only what that table doesn't already carry: why the lead was recommended,
-- at what priority, and (once the loop closes) the manually confirmed
-- terminal outcome. Everything else — "contacted", "recovered" (replied) —
-- is DERIVED at read time from the linked follow-up's status and the lead's
-- own message history, not duplicated here (see `lib/leads/recovery.ts`).
--
-- No existing table is restructured; no policy is dropped or weakened.

create table public.lead_recovery_attempts (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  lead_id           uuid not null references public.leads (id) on delete cascade,
  follow_up_id      uuid not null references public.lead_follow_ups (id) on delete cascade,
  -- Dictionary key (e.g. 'recovery.reasons.lostHot') — audit trail of why
  -- this attempt was recommended, since the lead's own status/temperature
  -- can change afterwards.
  reason_key        text not null,
  priority          text not null check (priority in ('high', 'medium', 'low')),
  -- Terminal, manually/derived-and-persisted outcome. NULL while still "in
  -- flight" (pending / contacted / recovered are all live-derived, never
  -- stored). Set once by the app when the loop closes — see
  -- `resolveStaleRecoveryAttempts` in queries.ts.
  resolved_as       text check (resolved_as in ('converted', 'no_response')),
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger lead_recovery_attempts_set_updated_at
  before update on public.lead_recovery_attempts
  for each row execute function private.set_updated_at();

create index lead_recovery_attempts_lead_id_idx on public.lead_recovery_attempts (lead_id);
create index lead_recovery_attempts_org_created_idx
  on public.lead_recovery_attempts (organization_id, created_at desc);

-- Duplicate-attempt guard (hard, DB-level): at most one OPEN (unresolved)
-- recovery attempt per lead at a time. A second attempt while one is still
-- open raises a unique violation (23505), mapped to a friendly "already in
-- progress" outcome — the same pattern already used for
-- `whatsapp_connections`' phone-number-id uniqueness.
create unique index lead_recovery_attempts_open_per_lead
  on public.lead_recovery_attempts (lead_id)
  where resolved_at is null;

-- ── RLS (same model as lead_follow_ups: members read, writers write) ───────

alter table public.lead_recovery_attempts enable row level security;

grant select, insert, update on public.lead_recovery_attempts to authenticated;

create policy lead_recovery_attempts_select_members
  on public.lead_recovery_attempts for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create policy lead_recovery_attempts_insert_writers
  on public.lead_recovery_attempts for insert to authenticated
  with check (
    private.has_org_role(organization_id, array['owner', 'admin', 'manager', 'sales'])
  );

-- Update is restricted to the same write roles and only ever touches
-- resolved_as/resolved_at in application code (the lazy terminal-state
-- write-back) — never lead/org/follow-up linkage.
create policy lead_recovery_attempts_update_writers
  on public.lead_recovery_attempts for update to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin', 'manager', 'sales'])
  )
  with check (
    private.has_org_role(organization_id, array['owner', 'admin', 'manager', 'sales'])
  );

-- No DELETE policy: an attempt is resolved (status), never deleted, so the
-- history stays auditable for future recovered-revenue reporting.
