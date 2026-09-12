-- LeadFlow AI — Concurrency-safe lead contact de-duplication.
--
-- Load-test evidence (Enterprise Readiness phase, 2026-09-12): 30 concurrent
-- anonymous chat sessions sending the identical phone number to one org
-- produced 224 separate lead rows instead of collapsing to ~1.
-- `findLeadByContact` (src/lib/persistence/persist.ts) was a plain SELECT
-- used to decide whether to INSERT — a classic check-then-write race, the
-- exact class of bug `creation_request_id`
-- (20260904130000_chat_idempotency.sql) already closed for exact-retry
-- duplicates. This closes the SAME race for cross-session contact dedup
-- (same visitor, different anonymous browser session / no shared requestId)
-- — the `phone_match_key` work explicitly deferred in the Production
-- Hardening phase "pending load-test evidence". This is that evidence.
--
-- `email_match_key` / `phone_match_key` are populated by the application at
-- write time (src/lib/persistence/lead-dedup.ts: normalizeEmail /
-- phoneMatchKey — lowercased trimmed email, last-9-digit Saudi suffix
-- respectively) and are nullable, so a lead with no contact info yet is
-- unaffected — NULLs are distinct in a unique index, exactly the existing
-- `creation_request_id` convention this migration continues. The
-- persistence layer now does one atomic
-- `INSERT ... ON CONFLICT (organization_id, <key>) DO UPDATE ... RETURNING`
-- instead of SELECT-then-INSERT for a lead with contact info.

alter table public.leads add column email_match_key text;
alter table public.leads add column phone_match_key text;

-- ── backfill existing rows ───────────────────────────────────────────────
--
-- A plain backfill could violate the unique indexes created below if
-- pre-existing duplicate leads already share a contact key within one org —
-- exactly the condition this migration exists because of (the load test
-- left 224 such rows in its own scratch database). Rather than guess how to
-- merge duplicates here, at most ONE row per (organization_id, key) is
-- backfilled — the oldest (first-seen) — so create unique index below can
-- never fail on this data; any leftover duplicate rows simply keep
-- `*_match_key = null` and are not merged retroactively. Deduplicating
-- historical rows, if desired, is a separate, deliberate data-quality task.

with ranked_email as (
  select id, lower(trim(email)) as key,
         row_number() over (
           partition by organization_id, lower(trim(email))
           order by created_at asc
         ) as rn
  from public.leads
  where email is not null
    and trim(email) ~ '^[^@[:space:]]+@[^@[:space:].][^@[:space:]]*\.[^@[:space:]]+$'
)
update public.leads l
set email_match_key = r.key
from ranked_email r
where l.id = r.id and r.rn = 1;

with ranked_phone as (
  select id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 9) as key,
         row_number() over (
           partition by organization_id, right(regexp_replace(phone, '[^0-9]', '', 'g'), 9)
           order by created_at asc
         ) as rn
  from public.leads
  where phone is not null
    and length(regexp_replace(phone, '[^0-9]', '', 'g')) >= 7
)
update public.leads l
set phone_match_key = r.key
from ranked_phone r
where l.id = r.id and r.rn = 1;

-- ── the actual guarantee ─────────────────────────────────────────────────

create unique index leads_org_email_match_key_key
  on public.leads (organization_id, email_match_key);
create unique index leads_org_phone_match_key_key
  on public.leads (organization_id, phone_match_key);
