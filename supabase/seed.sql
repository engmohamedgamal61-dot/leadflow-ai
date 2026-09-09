-- Local / development seed. Runs on `supabase db reset` and local `supabase
-- start` — NOT on `supabase db push` to a remote project.
--
-- Two demo organizations so the anonymous marketing chat has somewhere to
-- persist against. The app ONLY writes anonymous leads here when
-- `LEADFLOW_ENABLE_DEMO_CHAT=1` and the process is not production
-- (`src/lib/org/resolve.ts` → `demoChatEnabled`), so production never persists
-- a real lead into a demo tenant even if these rows somehow exist.
--
-- Guard: only seed a database that has no real membership yet. A production
-- database has members, so this insert no-ops there — a second layer of
-- protection if this file is ever run against the wrong target.

insert into public.organizations (name, slug, industry_template_id)
select v.name, v.slug, v.industry_template_id
from (values
  ('Demo Real Estate', 'demo-real-estate', 'real-estate'),
  ('Demo Clinic', 'demo-clinic', 'clinic')
) as v(name, slug, industry_template_id)
where not exists (select 1 from public.organization_members)
on conflict (slug) do nothing;
