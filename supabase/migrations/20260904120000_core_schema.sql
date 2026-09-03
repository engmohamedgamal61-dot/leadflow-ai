-- LeadFlow AI — multi-tenant core schema (Phase A: foundation only).
--
-- Seven tenant tables. No industry-specific columns — industry data lives in
-- jsonb (`leads.custom_data`, `organization_configs.config`). RLS policies are
-- added in the next migration.

-- ── schemas ────────────────────────────────────────────────────────────────

-- Private helper functions used by RLS policies. Not exposed through the API
-- (PostgREST only serves the `public` schema). Grants are set in the RLS
-- migration.
create schema if not exists private;

-- ── enums ──────────────────────────────────────────────────────────────────

create type public.organization_status as enum ('active', 'suspended', 'archived');
create type public.organization_member_role as enum ('owner', 'admin', 'manager', 'sales', 'viewer');
create type public.lead_temperature as enum ('hot', 'warm', 'cold');
create type public.lead_status as enum (
  'new', 'contacted', 'qualified', 'appointment', 'won', 'lost', 'archived'
);
create type public.conversation_status as enum ('active', 'closed', 'archived');
create type public.message_role as enum ('user', 'assistant', 'system');

-- ── updated_at trigger ─────────────────────────────────────────────────────

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── organizations ──────────────────────────────────────────────────────────

create table public.organizations (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (char_length(name) between 1 and 200),
  slug                 text not null unique
                         check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  -- Industry template slug (e.g. "real-estate", "clinic"). Resolved against
  -- the app's template registry, not a DB foreign key.
  industry_template_id text not null,
  status               public.organization_status not null default 'active',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function private.set_updated_at();

-- ── organization_members ───────────────────────────────────────────────────

create table public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            public.organization_member_role not null default 'viewer',
  created_at      timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index organization_members_organization_id_idx on public.organization_members (organization_id);
create index organization_members_user_id_idx on public.organization_members (user_id);

-- ── organization_configs ───────────────────────────────────────────────────
-- Stores OVERRIDES ONLY (the shape of the app's OrganizationConfig minus the
-- ids) — never a resolved EffectiveConfig. The effective config is computed at
-- runtime from `organizations.industry_template_id` + this override blob.

create table public.organization_configs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  config          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger organization_configs_set_updated_at
  before update on public.organization_configs
  for each row execute function private.set_updated_at();

-- ── leads ──────────────────────────────────────────────────────────────────
-- Core columns are industry-agnostic. Everything industry-specific goes in
-- `custom_data` (mirrors the app's LeadData.customData).

create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text,
  phone           text,
  email           text,
  intent          text,
  custom_data     jsonb not null default '{}'::jsonb,
  score           integer not null default 0 check (score between 0 and 100),
  temperature     public.lead_temperature not null default 'cold',
  status          public.lead_status not null default 'new',
  source          text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function private.set_updated_at();

create index leads_organization_id_idx on public.leads (organization_id);
create index leads_org_status_idx on public.leads (organization_id, status);
create index leads_org_temperature_idx on public.leads (organization_id, temperature);
create index leads_org_score_idx on public.leads (organization_id, score desc);
create index leads_org_created_at_idx on public.leads (organization_id, created_at desc);

-- ── conversations ──────────────────────────────────────────────────────────

create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id         uuid not null references public.leads (id) on delete cascade,
  channel         text not null default 'web',
  status          public.conversation_status not null default 'active',
  started_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function private.set_updated_at();

create index conversations_organization_id_idx on public.conversations (organization_id);
create index conversations_lead_id_idx on public.conversations (lead_id);
create index conversations_org_status_idx on public.conversations (organization_id, status);
create index conversations_org_last_message_at_idx
  on public.conversations (organization_id, last_message_at desc);

-- ── messages ───────────────────────────────────────────────────────────────
-- No organization_id column by design — tenant access is derived through the
-- parent conversation (see RLS migration).

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role            public.message_role not null,
  content         text not null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at);

-- ── lead_events ────────────────────────────────────────────────────────────
-- Append-only audit history.

create table public.lead_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  lead_id         uuid not null references public.leads (id) on delete cascade,
  event_type      text not null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index lead_events_lead_id_created_at_idx on public.lead_events (lead_id, created_at desc);
create index lead_events_org_created_at_idx on public.lead_events (organization_id, created_at desc);
create index lead_events_org_event_type_idx on public.lead_events (organization_id, event_type);
