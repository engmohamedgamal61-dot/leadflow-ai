-- LeadFlow AI — change an organization's industry template after onboarding.
--
-- `organizations.industry_template_id` is the CANONICAL, single source of truth
-- for an org's industry (the app validates the slug against its template
-- registry). Onboarding sets it once; this RPC is the only supported way to
-- change it afterwards.
--
-- Why an RPC and not two RLS `update`s from the app:
--   * atomic — the industry change and the override reset commit together, or
--     not at all;
--   * the target org is derived from `auth.uid()` inside the function, never
--     from a client argument (same trust model as
--     `create_organization_with_owner`);
--   * owner/admin only — enforced here AND re-checked in the server action.
--
-- Config overrides are industry-coupled (field keys, qualification steps and
-- scoring rules are all specific to one template; the AI persona is phrased for
-- it). Carrying them onto a different base template would leave invalid /
-- misleading configuration, so an industry change RESETS
-- `organization_configs.config` to `{}` — the org falls back to the new
-- template's defaults and can re-customise from the AI settings page.
--
-- `search_path = ''` + fully-qualified names, per the Phase A helper convention.

create or replace function public.set_organization_industry(
  p_industry_template_id text
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_tpl    text := btrim(coalesce(p_industry_template_id, ''));
  v_org_id uuid;
  v_org    public.organizations;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Slug FORMAT only — the application validates membership of the template
  -- registry before calling (the DB is not the registry). Never defaults.
  if v_tpl !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'invalid industry template id' using errcode = '22023';
  end if;

  -- The caller's own organization, owner/admin only. One org per user for now,
  -- so the first matching membership is authoritative.
  select om.organization_id
    into v_org_id
  from public.organization_members om
  where om.user_id = v_uid
    and om.role in ('owner', 'admin')
  limit 1;

  if v_org_id is null then
    raise exception 'not permitted: owner or admin only' using errcode = '42501';
  end if;

  update public.organizations
     set industry_template_id = v_tpl
   where id = v_org_id
  returning * into v_org;

  -- Deliberate: overrides do not survive an industry change.
  update public.organization_configs
     set config = '{}'::jsonb
   where organization_id = v_org_id;

  return v_org;
end;
$$;

revoke all on function public.set_organization_industry(text) from public;
grant execute on function public.set_organization_industry(text) to authenticated;
