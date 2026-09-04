-- LeadFlow AI — Phase H: WhatsApp (Meta Cloud API) integration.
--
-- Three additions, each the minimum for a multi-tenant WhatsApp channel that
-- reuses the existing AI engine, persistence and follow-up scheduler:
--
--  1. `whatsapp_connections` — one Meta Cloud API connection per organization.
--     `phone_number_id` (Meta's identifier) is the ONLY trusted key for
--     resolving which organization an inbound webhook belongs to. The access
--     token is stored encrypted and is NOT selectable by `authenticated`
--     (column-level revoke) so it can never reach the browser.
--  2. `whatsapp_inbound_events` — provider message-id dedup so Meta's webhook
--     retries (expected, "for up to 7 days") never re-run the AI / persistence.
--  3. columns on the existing `messages` / `conversations` tables for provider
--     metadata + WhatsApp conversation mapping + the 24-hour session window.
--     All nullable / defaulted — web chat is unaffected.
--
-- No existing table is restructured; no policy is dropped or weakened.

-- ── 1. whatsapp_connections ──────────────────────────────────────────────

create table public.whatsapp_connections (
  id                     uuid primary key default gen_random_uuid(),
  -- One WhatsApp connection per org for the MVP.
  organization_id        uuid not null unique
                           references public.organizations (id) on delete cascade,
  provider               text not null default 'meta_cloud',
  -- Meta identifiers. `phone_number_id` is globally unique at Meta and is the
  -- trusted tenant-resolution key for inbound webhooks.
  phone_number_id        text not null unique,
  waba_id                text,
  display_phone_number   text,
  -- pending | connected | disconnected | error
  status                 text not null default 'pending',
  -- AES-256-GCM ciphertext (see src/lib/whatsapp/crypto.ts). Server-only.
  access_token_encrypted text,
  last_error             text check (last_error is null or char_length(last_error) <= 500),
  -- Limited, non-sensitive provider metadata (e.g. an out-of-window follow-up
  -- template name/language). Never a token, never a raw webhook payload.
  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger whatsapp_connections_set_updated_at
  before update on public.whatsapp_connections
  for each row execute function private.set_updated_at();

alter table public.whatsapp_connections enable row level security;

-- Supabase default-grants ALL on new public tables (anon + authenticated),
-- with RLS then restricting rows. Tighten that here: anon gets nothing, and
-- `authenticated` can read every column EXCEPT the encrypted token. The
-- outbound adapter reads the token with the service-role client inside the
-- trusted server boundary only — it can never reach the browser.
revoke all on public.whatsapp_connections from anon;
revoke select on public.whatsapp_connections from authenticated;
grant select
  (id, organization_id, provider, phone_number_id, waba_id,
   display_phone_number, status, last_error, metadata, created_at, updated_at)
  on public.whatsapp_connections to authenticated;

-- Read: any member of the org. Write: owner/admin only (same set as
-- `organization_configs` — a connection holds credentials).
create policy whatsapp_connections_select_members
  on public.whatsapp_connections for select to authenticated
  using (organization_id in (select private.user_org_ids()));

create policy whatsapp_connections_insert_admins
  on public.whatsapp_connections for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner', 'admin']));

create policy whatsapp_connections_update_admins
  on public.whatsapp_connections for update to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']))
  with check (private.has_org_role(organization_id, array['owner', 'admin']));

create policy whatsapp_connections_delete_admins
  on public.whatsapp_connections for delete to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']));

-- ── 2. whatsapp_inbound_events (webhook idempotency) ─────────────────────
-- Written only by the trusted webhook handler (service role). No policies for
-- `authenticated` — the dashboard has no reason to read raw provider ids.

create table public.whatsapp_inbound_events (
  provider_message_id text primary key,
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  received_at         timestamptz not null default now()
);

alter table public.whatsapp_inbound_events enable row level security;
revoke all on public.whatsapp_inbound_events from anon;
revoke all on public.whatsapp_inbound_events from authenticated;
grant insert, select on public.whatsapp_inbound_events to service_role;

-- ── 3. provider metadata on messages + WhatsApp mapping on conversations ──

alter table public.messages
  add column channel             text not null default 'web',
  add column provider            text,
  add column provider_message_id text,
  -- outbound: sent | delivered | read | failed
  add column delivery_status     text,
  add column provider_metadata   jsonb;

-- A provider message id identifies a message uniquely at Meta — dedup inbound
-- and bind delivery-status webhooks to the outbound row.
create unique index messages_provider_message_id_key
  on public.messages (provider_message_id)
  where provider_message_id is not null;

alter table public.conversations
  -- The customer's WhatsApp id (wa_id / phone). One active WhatsApp
  -- conversation per (org, contact) so repeat messages reuse the same lead.
  add column external_contact_id text,
  -- Last time the customer messaged us — drives the Meta 24-hour
  -- customer-service window check for free-form vs template sends.
  add column last_inbound_at     timestamptz;

create unique index conversations_org_channel_contact_key
  on public.conversations (organization_id, channel, external_contact_id)
  where external_contact_id is not null;
