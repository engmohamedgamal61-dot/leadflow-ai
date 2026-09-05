-- LeadFlow AI — Phase L fix: a recovery attempt whose outreach was never
-- actually delivered (WhatsApp not connected, send failed, or the follow-up
-- was cancelled) must never be recorded as "no_response" — that value means
-- "delivered, but the lead didn't reply within the window", which is a very
-- different (and misleading) signal from "we never reached them at all".
--
-- Widens the `resolved_as` check constraint to also accept 'failed' — kept
-- in its own migration (not editing 20260905190000's inline CHECK) per the
-- existing convention (e.g. 20260904160000_follow_up_status_values.sql).
-- No other schema change: same column, same nullability, same unique-open
-- index — a 'failed' resolution still frees the lead for a later attempt
-- exactly like 'no_response' does.

alter table public.lead_recovery_attempts
  drop constraint lead_recovery_attempts_resolved_as_check;

alter table public.lead_recovery_attempts
  add constraint lead_recovery_attempts_resolved_as_check
  check (resolved_as in ('converted', 'no_response', 'failed'));
