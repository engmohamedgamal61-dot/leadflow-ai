-- Chat persistence idempotency.
--
-- Why this migration is required: `persistChatTurn` runs a sequence of
-- statements (resolve → create lead → create conversation → insert messages →
-- insert events). Two truly simultaneous identical requests interleave inside
-- that sequence, each reads "nothing exists yet", and each writes — producing
-- duplicate leads / conversations / messages / events. Application-level
-- "recent history" checks cannot close that read-then-write window; a database
-- unique constraint can.
--
-- The request carries a per-turn `request_id` (a UUID the client generates in
-- the existing chat flow). The columns below are nullable, so pre-existing
-- rows and any non-chat writes are unaffected, and Postgres treats NULLs as
-- distinct in a unique index — only chat rows that carry an id are constrained.

alter table public.leads add column creation_request_id uuid;
alter table public.conversations add column creation_request_id uuid;
alter table public.messages add column request_id uuid;
alter table public.lead_events add column request_id uuid;

-- First-turn creation: one lead / one conversation per (org, request_id).
create unique index leads_org_creation_request_id_key
  on public.leads (organization_id, creation_request_id);
create unique index conversations_org_creation_request_id_key
  on public.conversations (organization_id, creation_request_id);

-- Per-turn writes: at most one user + one assistant message, and at most one
-- event of each type, per request.
create unique index messages_conversation_role_request_id_key
  on public.messages (conversation_id, role, request_id);
create unique index lead_events_lead_request_event_type_key
  on public.lead_events (lead_id, request_id, event_type);
