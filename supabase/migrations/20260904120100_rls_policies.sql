-- LeadFlow AI — Row Level Security.
--
-- Tenant isolation is enforced entirely in the database from the authenticated
-- user's `organization_members` rows. The frontend is never trusted.
--
-- Recursion is avoided by resolving membership through SECURITY DEFINER helper
-- functions owned by a BYPASSRLS role (the migration runner / `postgres`):
-- their internal reads of `organization_members` do NOT re-trigger that table's
-- own policies. Every helper pins `search_path = ''` and fully-qualifies names.

-- ── helper functions (SECURITY DEFINER) ────────────────────────────────────

-- Organization ids the current user belongs to.
create or replace function private.user_org_ids()
returns setof uuid
language sql
security definer
set search_path = ''
stable
as $$
  select organization_id
  from public.organization_members
  where user_id = (select auth.uid())
$$;

-- Does the current user hold one of `p_roles` in `p_org_id`?
create or replace function private.has_org_role(p_org_id uuid, p_roles text[])
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = p_org_id
      and user_id = (select auth.uid())
      and role::text = any(p_roles)
  )
$$;

-- Can the current user read the conversation (i.e. belongs to its org)?
create or replace function private.can_read_conversation(p_conversation_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.conversations c
    join public.organization_members m on m.organization_id = c.organization_id
    where c.id = p_conversation_id
      and m.user_id = (select auth.uid())
  )
$$;

-- Can the current user write to the conversation (org member with a write role)?
create or replace function private.can_write_conversation(p_conversation_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.conversations c
    join public.organization_members m on m.organization_id = c.organization_id
    where c.id = p_conversation_id
      and m.user_id = (select auth.uid())
      and m.role::text = any(array['owner', 'admin', 'manager', 'sales'])
  )
$$;

grant usage on schema private to authenticated;
grant execute on function
  private.user_org_ids(),
  private.has_org_role(uuid, text[]),
  private.can_read_conversation(uuid),
  private.can_write_conversation(uuid)
to authenticated;

-- ── table privileges ───────────────────────────────────────────────────────
-- Only `authenticated` gets DML privileges; `anon` gets nothing (all tenant
-- data requires a session). Row visibility is then narrowed by the policies
-- below. `messages` and `lead_events` are append-only (no update/delete grant).

grant select, insert, update, delete on
  public.organizations,
  public.organization_members,
  public.organization_configs,
  public.leads,
  public.conversations
to authenticated;

grant select, insert on public.messages, public.lead_events to authenticated;

-- Write roles for tenant data (everything except read-only `viewer`).
-- Used inline below rather than a helper to keep policy intent visible.

-- ── organizations ──────────────────────────────────────────────────────────

alter table public.organizations enable row level security;

create policy organizations_select_members
  on public.organizations for select to authenticated
  using (id in (select private.user_org_ids()));

create policy organizations_update_admins
  on public.organizations for update to authenticated
  using (private.has_org_role(id, array['owner', 'admin']))
  with check (private.has_org_role(id, array['owner', 'admin']));

-- No INSERT / DELETE policy: organization creation and deletion go through the
-- service role (onboarding / admin tooling is a later phase).

-- ── organization_members ───────────────────────────────────────────────────

alter table public.organization_members enable row level security;

create policy organization_members_select_members
  on public.organization_members for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create policy organization_members_insert_admins
  on public.organization_members for insert to authenticated
  with check (
    private.has_org_role(organization_id, array['owner', 'admin'])
    and (
      role <> 'owner'
      or private.has_org_role(organization_id, array['owner'])
    )
  );

-- Admins/owners may change OTHER members' rows only — never their own
-- (prevents self role-escalation) — and only an owner may grant `owner`.
create policy organization_members_update_admins
  on public.organization_members for update to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin'])
    and user_id <> (select auth.uid())
  )
  with check (
    private.has_org_role(organization_id, array['owner', 'admin'])
    and user_id <> (select auth.uid())
    and (
      role <> 'owner'
      or private.has_org_role(organization_id, array['owner'])
    )
  );

create policy organization_members_delete_admins
  on public.organization_members for delete to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin'])
    and user_id <> (select auth.uid())
  );

-- ── organization_configs ───────────────────────────────────────────────────

alter table public.organization_configs enable row level security;

create policy organization_configs_select_members
  on public.organization_configs for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create policy organization_configs_insert_admins
  on public.organization_configs for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner', 'admin']));

create policy organization_configs_update_admins
  on public.organization_configs for update to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']))
  with check (private.has_org_role(organization_id, array['owner', 'admin']));

create policy organization_configs_delete_admins
  on public.organization_configs for delete to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']));

-- ── leads ──────────────────────────────────────────────────────────────────

alter table public.leads enable row level security;

create policy leads_select_members
  on public.leads for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create policy leads_insert_writers
  on public.leads for insert to authenticated
  with check (
    private.has_org_role(organization_id, array['owner', 'admin', 'manager', 'sales'])
  );

create policy leads_update_writers
  on public.leads for update to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin', 'manager', 'sales'])
  )
  with check (
    private.has_org_role(organization_id, array['owner', 'admin', 'manager', 'sales'])
  );

create policy leads_delete_admins
  on public.leads for delete to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin', 'manager']));

-- ── conversations ──────────────────────────────────────────────────────────

alter table public.conversations enable row level security;

create policy conversations_select_members
  on public.conversations for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create policy conversations_insert_writers
  on public.conversations for insert to authenticated
  with check (
    private.has_org_role(organization_id, array['owner', 'admin', 'manager', 'sales'])
  );

create policy conversations_update_writers
  on public.conversations for update to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin', 'manager', 'sales'])
  )
  with check (
    private.has_org_role(organization_id, array['owner', 'admin', 'manager', 'sales'])
  );

create policy conversations_delete_admins
  on public.conversations for delete to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin', 'manager']));

-- ── messages ───────────────────────────────────────────────────────────────
-- Access is derived through conversation → organization → membership.
-- Messages are append-only (no UPDATE / DELETE policy).

alter table public.messages enable row level security;

create policy messages_select_members
  on public.messages for select to authenticated
  using (private.can_read_conversation(conversation_id));

create policy messages_insert_writers
  on public.messages for insert to authenticated
  with check (private.can_write_conversation(conversation_id));

-- ── lead_events ────────────────────────────────────────────────────────────
-- Append-only audit history (no UPDATE / DELETE policy).

alter table public.lead_events enable row level security;

create policy lead_events_select_members
  on public.lead_events for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create policy lead_events_insert_writers
  on public.lead_events for insert to authenticated
  with check (
    private.has_org_role(organization_id, array['owner', 'admin', 'manager', 'sales'])
  );
