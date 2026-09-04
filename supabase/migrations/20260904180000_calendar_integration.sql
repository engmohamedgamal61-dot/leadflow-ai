-- LeadFlow AI — Phase J: appointment & calendar integration.
--
-- Two additions, following the same pattern as `whatsapp_integration.sql`:
--
--  1. `organization_calendar_connections` — one calendar connection per
--     organization (Google Calendar first; `provider` is a plain column so
--     Outlook/Calendly are a future value, not a schema change). OAuth tokens
--     are stored encrypted and are NOT selectable by `authenticated` — same
--     column-revoke pattern as the WhatsApp access token.
--  2. `appointments` — one row per booked appointment. A Postgres EXCLUDE
--     constraint (needs `btree_gist`) is the hard, DB-level guarantee against
--     double-booking: no two active appointments on the same calendar
--     connection may have overlapping time ranges, enforced atomically by
--     Postgres itself — not by application-level check-then-insert logic.
--
-- No existing table is restructured; no policy is dropped or weakened.
-- `leads.status` already has an `'appointment'` value (Phase A) — no enum
-- change needed. `lead_events.event_type` is free-text — new appointment
-- event types need no migration either.

create extension if not exists btree_gist;

-- ── 1. organization_calendar_connections ────────────────────────────────

create table public.organization_calendar_connections (
  id                      uuid primary key default gen_random_uuid(),
  -- One calendar connection per org for the MVP.
  organization_id         uuid not null unique
                            references public.organizations (id) on delete cascade,
  provider                text not null default 'google',
  -- pending | connected | disconnected | error
  status                  text not null default 'pending',
  calendar_id             text,
  calendar_email          text,
  timezone                text not null default 'Asia/Riyadh',
  -- AES-256-GCM ciphertext (see src/lib/calendar/crypto.ts). Server-only.
  access_token_encrypted  text,
  refresh_token_encrypted text,
  token_expires_at        timestamptz,
  last_error              text check (last_error is null or char_length(last_error) <= 500),
  -- Working days/hours, slot size, lookahead, minimum notice — validated in
  -- app code (src/lib/calendar/config.ts), same pattern as
  -- whatsapp_connections.metadata.
  settings                jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger organization_calendar_connections_set_updated_at
  before update on public.organization_calendar_connections
  for each row execute function private.set_updated_at();

alter table public.organization_calendar_connections enable row level security;

-- Same tightening as whatsapp_connections: anon gets nothing; authenticated
-- can read every column EXCEPT the two encrypted tokens. Only the trusted
-- server boundary (OAuth callback, AI executor, manual booking actions)
-- decrypts them — never the browser.
revoke all on public.organization_calendar_connections from anon;
revoke select on public.organization_calendar_connections from authenticated;
grant select
  (id, organization_id, provider, status, calendar_id, calendar_email,
   timezone, last_error, settings, created_at, updated_at)
  on public.organization_calendar_connections to authenticated;
grant insert, update, delete on public.organization_calendar_connections to authenticated;

-- Read: any member of the org. Write: owner/admin only (same set as
-- organization_configs / whatsapp_connections — a connection holds credentials).
create policy calendar_connections_select_members
  on public.organization_calendar_connections for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create policy calendar_connections_insert_admins
  on public.organization_calendar_connections for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner', 'admin']));

create policy calendar_connections_update_admins
  on public.organization_calendar_connections for update to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']))
  with check (private.has_org_role(organization_id, array['owner', 'admin']));

create policy calendar_connections_delete_admins
  on public.organization_calendar_connections for delete to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']));

-- ── 2. appointments ───────────────────────────────────────────────────────

create table public.appointments (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  lead_id               uuid not null references public.leads (id) on delete cascade,
  conversation_id       uuid references public.conversations (id) on delete set null,
  calendar_connection_id uuid references public.organization_calendar_connections (id) on delete set null,
  -- The provider's event id (e.g. Google Calendar event id) — needed to
  -- update/delete the real calendar event. Null if the connection was later
  -- removed; the appointment row remains as history.
  provider_event_id    text,
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  timezone              text not null default 'Asia/Riyadh',
  -- scheduled | rescheduled | cancelled | completed | no_show
  status                text not null default 'scheduled',
  -- 'chat' (booked by the AI, any channel) or 'manual' (dashboard) — same
  -- convention as lead_follow_ups.source.
  source                text not null default 'manual',
  notes                 text check (notes is null or char_length(notes) <= 500),
  cancelled_reason      text check (cancelled_reason is null or char_length(cancelled_reason) <= 200),
  -- Idempotency: a retried chat turn carries the same request id. NULL for
  -- manual rows (Postgres treats NULLs as distinct in a plain unique index).
  creation_request_id   uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint appointments_ends_after_starts check (ends_at > starts_at)
);

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function private.set_updated_at();

create index appointments_lead_id_idx on public.appointments (lead_id);
create index appointments_org_status_starts_idx
  on public.appointments (organization_id, status, starts_at);
create unique index appointments_lead_creation_request_id_key
  on public.appointments (lead_id, creation_request_id);

-- Hard, DB-level double-booking guard: no two active appointments on the same
-- calendar connection may overlap. `&&` on `tstzrange` is the overlap test;
-- `[)` matches how a slot [starts_at, ends_at) is generated (a slot ending
-- exactly when another begins is NOT a conflict). Only enforced while the
-- calendar connection is known (an orphaned appointment with no connection
-- can't be scheduled fresh against it anyway) and only for active statuses —
-- a cancelled/completed appointment must never block a new booking.
alter table public.appointments
  add constraint appointments_no_overlap
  exclude using gist (
    calendar_connection_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (calendar_connection_id is not null and status in ('scheduled', 'rescheduled'));

-- ── RLS (same model as lead_follow_ups: members read, writers write, no delete) ──

alter table public.appointments enable row level security;

grant select, insert, update on public.appointments to authenticated;

create policy appointments_select_members
  on public.appointments for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create policy appointments_insert_writers
  on public.appointments for insert to authenticated
  with check (
    private.has_org_role(organization_id, array['owner', 'admin', 'manager', 'sales'])
  );

create policy appointments_update_writers
  on public.appointments for update to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin', 'manager', 'sales'])
  )
  with check (
    private.has_org_role(organization_id, array['owner', 'admin', 'manager', 'sales'])
  );

-- No DELETE policy: an appointment is cancelled (status), never deleted, so
-- the history stays auditable — same precedent as lead_follow_ups.
