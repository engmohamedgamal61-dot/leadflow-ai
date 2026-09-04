-- LeadFlow AI — Phase G: two execution states for the follow-up scheduler.
--
-- Kept in its own migration: a new enum value cannot be *used* in the same
-- transaction that adds it, and the scheduler migration that follows uses
-- both of these (partial index + claim function).
--
-- `processing` — REQUIRED so the atomic claim marks a row as "being worked on"
--   and a second worker's `pending`-only claim query cannot re-pick it.
-- `failed` — REQUIRED so a follow-up reaches a terminal state after max
--   retries instead of being retried forever.

alter type public.follow_up_status add value if not exists 'processing';
alter type public.follow_up_status add value if not exists 'failed';
