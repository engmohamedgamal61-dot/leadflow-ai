-- LeadFlow AI — Pilot Hardening & Customer Plumbing.
--
-- Three additions for the first real customer pilot. No existing table is
-- restructured; no policy is dropped or weakened. Every helper follows the
-- Phase A convention (SECURITY DEFINER owned by the migration runner,
-- search_path = '', fully-qualified names).
--
--   1. public.hit_rate_limit  — atomic fixed-window counter, for the public
--      AI/chat entry points (Anthropic cost-abuse protection).
--   2. organization_invitations — token-based team invites for the existing
--      roles, with the same privilege-escalation guard as
--      organization_members_insert_admins.
--   3. organization_widget_settings — a per-org public widget key so a
--      customer receives leads from their own site instead of the demo org.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. Rate limiting
-- ══════════════════════════════════════════════════════════════════════════

create table private.rate_limits (
  key           text primary key,
  window_start  timestamptz not null default now(),
  count         integer not null default 0
);

-- Atomic "record a hit and tell me if it's still under the limit". A fixed
-- window: when the current window has expired the counter resets to 1,
-- otherwise it increments. Returns TRUE while count <= p_max.
--
-- In `public` so PostgREST can expose it to the `.rpc()` call, but locked to
-- `service_role` only (revoked from public/anon/authenticated) — exactly the
-- `public.claim_due_follow_ups` pattern. The counter table stays in `private`;
-- the SECURITY DEFINER function reaches it.
create or replace function public.hit_rate_limit(
  p_key            text,
  p_max            integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into private.rate_limits as rl (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case
      when rl.window_start < now() - make_interval(secs => p_window_seconds)
        then now()
      else rl.window_start
    end,
    count = case
      when rl.window_start < now() - make_interval(secs => p_window_seconds)
        then 1
      else rl.count + 1
    end
  returning rl.count into v_count;

  return v_count <= p_max;
end;
$$;

revoke all on function public.hit_rate_limit(text, integer, integer) from public;
revoke all on function public.hit_rate_limit(text, integer, integer) from anon;
revoke all on function public.hit_rate_limit(text, integer, integer) from authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. Team invitations
-- ══════════════════════════════════════════════════════════════════════════

create table public.organization_invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email           text not null check (char_length(email) between 3 and 320),
  -- Reuses the member-role enum. 'owner' is intentionally NOT accepted here —
  -- owner transfer is a separate, riskier operation the pilot doesn't need.
  role            public.organization_member_role not null
                    check (role <> 'owner'),
  -- sha256 hex of the raw token; the raw token only ever lives in the emailed
  -- link (mirrors the OAuth-state / cron-secret handling).
  token_hash      text not null unique,
  invited_by      uuid not null references auth.users (id) on delete cascade,
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  accepted_by     uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger organization_invitations_set_updated_at
  before update on public.organization_invitations
  for each row execute function private.set_updated_at();

create index organization_invitations_org_idx
  on public.organization_invitations (organization_id, created_at desc);

-- One pending invite per (org, email).
create unique index organization_invitations_pending_email
  on public.organization_invitations (organization_id, lower(email))
  where accepted_at is null;

alter table public.organization_invitations enable row level security;

grant select, insert, update, delete on public.organization_invitations to authenticated;

-- Reads: owner/admin only (the row carries an invitee email).
create policy organization_invitations_select_admins
  on public.organization_invitations for select to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']));

-- Creating an invite is the authorization gate. Same shape as
-- `organization_members_insert_admins`: owner/admin, and — since the CHECK
-- constraint already forbids 'owner' — no extra owner guard is needed here.
create policy organization_invitations_insert_admins
  on public.organization_invitations for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner', 'admin']));

-- Owner/admin may revoke a pending invite.
create policy organization_invitations_delete_admins
  on public.organization_invitations for delete to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']));

-- No UPDATE policy for `authenticated`: acceptance is performed by the trusted
-- server (service role) after it re-validates the token, the invitee's email,
-- and one-org-per-user — never by the invitee's own session.

-- ══════════════════════════════════════════════════════════════════════════
-- 3. Per-organization website widget
-- ══════════════════════════════════════════════════════════════════════════

create table public.organization_widget_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  -- Public identifier embedded in the customer's site (like a publishable
  -- key). Rotatable. Not a secret — tenant isolation is still RLS.
  widget_key      uuid not null unique default gen_random_uuid(),
  enabled         boolean not null default false,
  -- Origins allowed to embed the widget (for a future frame-ancestors /
  -- CORS lock-down); empty array = no restriction recorded yet.
  allowed_origins text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger organization_widget_settings_set_updated_at
  before update on public.organization_widget_settings
  for each row execute function private.set_updated_at();

alter table public.organization_widget_settings enable row level security;

grant select, insert, update, delete on public.organization_widget_settings to authenticated;

-- Any member may see the widget config (the key is semi-public anyway).
create policy organization_widget_settings_select_members
  on public.organization_widget_settings for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create policy organization_widget_settings_insert_admins
  on public.organization_widget_settings for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner', 'admin']));

create policy organization_widget_settings_update_admins
  on public.organization_widget_settings for update to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']))
  with check (private.has_org_role(organization_id, array['owner', 'admin']));

create policy organization_widget_settings_delete_admins
  on public.organization_widget_settings for delete to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']));
