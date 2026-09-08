-- LeadFlow AI — Phase O: AI usage & cost metering.
--
-- Tracks every Anthropic call per organization (tokens, model, request type,
-- estimated cost) so LeadFlow can support paid plans, usage limits and margin
-- monitoring. Two tables + one aggregation function. No existing table is
-- restructured, no policy dropped, and NO existing AI/chat behaviour changes:
-- recording is additive (a best-effort insert on the trusted server boundary)
-- and enforcement is a no-op for any org without a configured hard limit.
--
--   1. `ai_usage_events`            — append-only, one row per Anthropic call.
--   2. `organization_usage_limits`  — per-org monthly limits + warning threshold.
--   3. `org_ai_usage_totals(...)`   — service-role aggregate for pre-call enforcement.
--
-- Privacy: metering rows carry token counts and an estimated cost only — never
-- an API key, a prompt, or message content. `conversation_id` / `lead_id` are
-- nullable references for cost attribution (avg cost per conversation / lead).
--
-- Access: cost data is owner/admin only (a `viewer` — and `manager` / `sales` —
-- can see leads but not billing). Same precedent as
-- `organization_invitations_select_admins`, which also carries sensitive data.

-- ── 1. ai_usage_events ───────────────────────────────────────────────────────

create table public.ai_usage_events (
  id                           uuid primary key default gen_random_uuid(),
  organization_id              uuid not null references public.organizations (id) on delete cascade,
  -- Canonical request type (src/lib/metering/types.ts): 'chat_reply' |
  -- 'lead_extraction' | … . Free text so a future request type needs no
  -- migration; an unknown value simply groups under "other" in the UI.
  request_type                 text not null check (char_length(request_type) between 1 and 40),
  -- The Anthropic model string actually used, e.g. 'claude-sonnet-5'.
  model                        text not null check (char_length(model) between 1 and 80),
  -- Origin channel ('web' | 'whatsapp' | …), for cost-by-channel later. Optional.
  channel                      text check (channel is null or char_length(channel) <= 40),
  input_tokens                 integer not null default 0 check (input_tokens >= 0),
  output_tokens                integer not null default 0 check (output_tokens >= 0),
  cache_read_input_tokens      integer not null default 0 check (cache_read_input_tokens >= 0),
  cache_creation_input_tokens  integer not null default 0 check (cache_creation_input_tokens >= 0),
  -- Estimated USD cost, computed at insert time from the centralized pricing
  -- config (src/lib/metering/pricing.ts). Stored so historical cost is stable
  -- even when pricing config later changes.
  estimated_cost_usd           numeric(14, 8) not null default 0 check (estimated_cost_usd >= 0),
  conversation_id              uuid references public.conversations (id) on delete set null,
  lead_id                      uuid references public.leads (id) on delete set null,
  -- Per-turn idempotency key (same value a retried chat turn carries). NULL for
  -- calls with no request id — Postgres treats NULLs as distinct so those never
  -- collide.
  request_id                   uuid,
  occurred_at                  timestamptz not null default now(),
  created_at                   timestamptz not null default now()
);

create index ai_usage_events_org_occurred_idx
  on public.ai_usage_events (organization_id, occurred_at desc);

-- Idempotency: one row per (org, request id, request type). A retried chat turn
-- re-runs reply + extraction with the same request id; this collapses the
-- duplicate metering rows the same way the persistence layer collapses its own.
-- A FULL (not partial) unique index so PostgREST's `on_conflict=` can infer it
-- as the arbiter — same precedent as `integration_deliveries_endpoint_event_key`.
-- Rows with a NULL `request_id` never collide (Postgres NULLs are distinct), so
-- calls made without a request id are all kept.
create unique index ai_usage_events_idempotency_key
  on public.ai_usage_events (organization_id, request_id, request_type);

alter table public.ai_usage_events enable row level security;

-- anon: nothing. authenticated: read only (append-only table; writes are
-- server-role only — the metering service always runs on the trusted boundary,
-- and the public chat widget has no session to write under anyway).
revoke all on public.ai_usage_events from anon;
grant select on public.ai_usage_events to authenticated;
grant select, insert on public.ai_usage_events to service_role;

-- Read: owner/admin of the org only (cost data).
create policy ai_usage_events_select_admins
  on public.ai_usage_events for select to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']));

-- No UPDATE / DELETE policy — append-only, same as `messages` / `lead_events`.

-- ── 2. organization_usage_limits ─────────────────────────────────────────────

create table public.organization_usage_limits (
  organization_id            uuid primary key references public.organizations (id) on delete cascade,
  -- NULL = that dimension is not limited. All limits are per calendar month
  -- (in the billing timezone, resolved in app code — src/lib/metering/period.ts).
  monthly_token_limit        bigint  check (monthly_token_limit is null or monthly_token_limit >= 0),
  monthly_request_limit      integer check (monthly_request_limit is null or monthly_request_limit >= 0),
  monthly_cost_limit_usd     numeric(12, 2) check (monthly_cost_limit_usd is null or monthly_cost_limit_usd >= 0),
  -- Percentage of a limit at which the dashboard shows a warning. 1–100.
  warning_threshold_percent  integer not null default 80
                               check (warning_threshold_percent between 1 and 100),
  -- When false (default), limits are advisory: the dashboard warns but nothing
  -- is ever blocked. When true, an exceeded limit blocks new Anthropic calls
  -- for that org (existing conversations get a graceful fallback).
  hard_limit_enabled         boolean not null default false,
  updated_by                 uuid references auth.users (id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create trigger organization_usage_limits_set_updated_at
  before update on public.organization_usage_limits
  for each row execute function private.set_updated_at();

alter table public.organization_usage_limits enable row level security;

revoke all on public.organization_usage_limits from anon;
grant select, insert, update on public.organization_usage_limits to authenticated;
grant select on public.organization_usage_limits to service_role;

-- Read + write: owner/admin only. Billing/cost configuration is not visible to
-- viewers, managers or sales.
create policy organization_usage_limits_select_admins
  on public.organization_usage_limits for select to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']));

create policy organization_usage_limits_insert_admins
  on public.organization_usage_limits for insert to authenticated
  with check (private.has_org_role(organization_id, array['owner', 'admin']));

create policy organization_usage_limits_update_admins
  on public.organization_usage_limits for update to authenticated
  using (private.has_org_role(organization_id, array['owner', 'admin']))
  with check (private.has_org_role(organization_id, array['owner', 'admin']));

-- No DELETE policy: an org clears a limit by nulling the column, not by
-- deleting the row (keeps `warning_threshold_percent` / `hard_limit_enabled`).

-- ── 3. org_ai_usage_totals — pre-call enforcement aggregate ──────────────────
-- Deterministic sum over a half-open [p_from, p_to) window for one org. Locked
-- to `service_role` (the metering enforcement path runs on the trusted server
-- boundary, exactly like `hit_rate_limit`). The dashboard does NOT use this —
-- it reads RLS-scoped rows and aggregates them in app code.

create or replace function public.org_ai_usage_totals(
  p_org_id uuid,
  p_from   timestamptz,
  p_to     timestamptz
)
returns table (
  total_input_tokens  bigint,
  total_output_tokens bigint,
  total_tokens        bigint,
  total_requests      bigint,
  total_cost_usd      numeric
)
language sql
security definer
set search_path = ''
stable
as $$
  select
    coalesce(sum(e.input_tokens), 0)::bigint,
    coalesce(sum(e.output_tokens), 0)::bigint,
    coalesce(sum(
      e.input_tokens + e.output_tokens
      + e.cache_read_input_tokens + e.cache_creation_input_tokens
    ), 0)::bigint,
    count(*)::bigint,
    coalesce(sum(e.estimated_cost_usd), 0)::numeric
  from public.ai_usage_events e
  where e.organization_id = p_org_id
    and e.occurred_at >= p_from
    and e.occurred_at <  p_to
$$;

revoke all on function public.org_ai_usage_totals(uuid, timestamptz, timestamptz) from public;
revoke all on function public.org_ai_usage_totals(uuid, timestamptz, timestamptz) from anon;
revoke all on function public.org_ai_usage_totals(uuid, timestamptz, timestamptz) from authenticated;
grant execute on function public.org_ai_usage_totals(uuid, timestamptz, timestamptz) to service_role;
