-- Local / development seed. Runs on `supabase db reset` and local `supabase
-- start` — NOT on `supabase db push` to a remote project.
--
-- Two demo organizations so the chat widget has an organization to persist
-- against before authentication exists. No members yet (Auth phase).

insert into public.organizations (name, slug, industry_template_id)
values
  ('Demo Real Estate', 'demo-real-estate', 'real-estate'),
  ('Demo Clinic', 'demo-clinic', 'clinic')
on conflict (slug) do nothing;
