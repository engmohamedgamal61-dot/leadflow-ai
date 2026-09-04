-- LeadFlow AI — Phase F: scheduled lead follow-ups.
--
-- Why a new table: `lead_events` is an append-only audit history. A scheduled
-- follow-up is mutable future work (pending → completed / cancelled) that the
-- dashboard queries by due date — recording it as an event would lose the
-- status transitions and force awkward "latest event wins" reads. This is the
-- minimal model for that: one row per scheduled follow-up.
--
-- No changes to existing tables, policies, or the RLS security model. The
-- policies below reuse the same `private.*` helpers and role sets as `leads`.

create type public.follow_up_status as enum ('pending', 'completed', 'cancelled');

create table public.lead_follow_ups (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  lead_id             uuid not null references public.leads (id) on delete cascade,
  -- Which conversation surfaced the follow-up, if any. Kept if the conversation
  -- is later removed.
  conversation_id     uuid references public.conversations (id) on delete set null,
  scheduled_at        timestamptz not null,
  status              public.follow_up_status not null default 'pending',
  note                text check (note is null or char_length(note) <= 500),
  -- 'chat' (proposed by the AI during a conversation) or 'manual' (dashboard).
  source              text not null default 'manual',
  -- Idempotency: a retried chat turn carries the same request id, so the
  -- unique index below collapses its follow-up into one. NULL for manual rows
  -- (Postgres treats NULLs as distinct), which the app guards separately.
  creation_request_id uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger lead_follow_ups_set_updated_at
  before update on public.lead_follow_ups
  for each row execute function private.set_updated_at();

create index lead_follow_ups_lead_id_idx on public.lead_follow_ups (lead_id);
create index lead_follow_ups_org_status_scheduled_idx
  on public.lead_follow_ups (organization_id, status, scheduled_at);
create unique index lead_follow_ups_lead_creation_request_id_key
  on public.lead_follow_ups (lead_id, creation_request_id);

-- ── RLS (same model as leads: members read, writers write) ─────────────────

alter table public.lead_follow_ups enable row level security;

grant select, insert, update on public.lead_follow_ups to authenticated;

create policy lead_follow_ups_select_members
  on public.lead_follow_ups for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create policy lead_follow_ups_insert_writers
  on public.lead_follow_ups for insert to authenticated
  with check (
    private.has_org_role(organization_id, array['owner', 'admin', 'manager', 'sales'])
  );

create policy lead_follow_ups_update_writers
  on public.lead_follow_ups for update to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin', 'manager', 'sales'])
  )
  with check (
    private.has_org_role(organization_id, array['owner', 'admin', 'manager', 'sales'])
  );

-- No DELETE policy: a follow-up is cancelled (status), never deleted, so the
-- history stays auditable.
