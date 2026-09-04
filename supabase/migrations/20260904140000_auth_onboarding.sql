-- LeadFlow AI — Phase C: organization onboarding.
--
-- Adds ONE thing: an atomic, server-evaluated way for an authenticated user
-- with no organization to create their first one. Direct INSERTs into
-- `organizations` / `organization_members` are (correctly) impossible under the
-- Phase A RLS model — `organizations` has no INSERT policy, and the
-- `organization_members` INSERT policy requires the caller to *already* be an
-- owner/admin of the target org. Onboarding is that bootstrap.
--
-- No table changes. No RLS changes. No policy is added, dropped or weakened.

-- ── onboarding: create organization + owner membership + empty config ──────
--
-- SECURITY DEFINER so it can perform the bootstrap INSERTs the caller's own
-- role cannot — but it is tightly constrained:
--   * the owner is always `auth.uid()` (never a parameter — the client cannot
--     create an org owned by someone else),
--   * it refuses if the caller already belongs to an organization (one org per
--     user for now; existing membership + role are never touched),
--   * the whole thing is one function body = one transaction, so a failure
--     part-way through rolls everything back — no partially initialised org.
--
-- `search_path = ''` + fully-qualified names, per the Phase A helper convention.
-- The industry template slug is stored as-is; the application validates it
-- against its template registry before calling (the DB is not the registry).

create or replace function public.create_organization_with_owner(
  p_name                 text,
  p_industry_template_id text
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_tpl  text := btrim(coalesce(p_industry_template_id, ''));
  v_base text;
  v_slug text;
  v_org  public.organizations;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 200 then
    raise exception 'organization name must be 1-200 characters'
      using errcode = '22023';
  end if;

  if v_tpl !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'invalid industry template id' using errcode = '22023';
  end if;

  -- One organization per user for now. Never modify an existing membership.
  if exists (
    select 1 from public.organization_members where user_id = v_uid
  ) then
    raise exception 'user already belongs to an organization'
      using errcode = '23505';
  end if;

  -- Derive a URL-safe slug from the name + a short random suffix so concurrent
  -- signups with the same name don't collide. A collision still rolls the whole
  -- transaction back via the unique constraint (safe — nothing is left behind).
  v_base := btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-');
  if v_base = '' then
    v_base := 'org';
  end if;
  v_slug := left(v_base, 40) || '-' || substr(md5(random()::text), 1, 6);

  insert into public.organizations (name, slug, industry_template_id)
  values (v_name, v_slug, v_tpl)
  returning * into v_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org.id, v_uid, 'owner');

  insert into public.organization_configs (organization_id, config)
  values (v_org.id, '{}'::jsonb);

  return v_org;
end;
$$;

-- Only signed-in users, and only for themselves (owner = auth.uid() inside).
revoke all on function public.create_organization_with_owner(text, text) from public;
grant execute on function public.create_organization_with_owner(text, text)
  to authenticated;
