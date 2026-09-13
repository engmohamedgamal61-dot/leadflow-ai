# Incident runbook

Concise, symptom-first playbook for the operator (you — there is no on-call
rotation or paging system configured yet, see `FINDINGS.md`'s remaining
gaps). Pairs with `docs/PRODUCTION-HARDENING.md` (cron/observability
reference) and `docs/BACKUP-RESTORE.md` (data recovery). Every "how to
confirm" step below uses infrastructure that already exists in this
repo — no new tool to learn under pressure.

## Quick reference

| Incident | First check |
|---|---|
| Database outage | `GET /api/health/ready` → `503` |
| Anthropic outage/timeout/429 | Chat replies show `chat.errors.busy` / `chat.errors.unavailable` |
| Google Calendar failure | Chat stops mentioning appointment slots; booking returns `errors.calendar.providerFailed` |
| Integration Hub backlog | `GET /api/internal/ops/summary` → `integrationHub.pendingDeliveries`/`pendingFanout` growing |
| Follow-up worker backlog | same route → `followUps.pendingDue`/`oldestDueSeconds` growing |
| Cron not running | same route → any `oldestDueSeconds`/`oldestPendingSeconds` far exceeding the cron's own interval |
| Bad deploy | Vercel dashboard → error rate / function duration spike right after a deploy |

---

## 1. Database outage (Supabase down or unreachable)

**Symptoms**: `/api/chat` still returns `200` with a real AI reply (by
design — see the Supabase-outage hardening phase) but the trailer/response
carries `"degraded": true`; the widget shows "Your message was answered, but
we couldn't save this conversation. Please retry." Dashboard pages fail to
load or hang. Cron routes (`/api/internal/*`) return `503`/error summaries.

**How to confirm**: `curl https://<your-domain>/api/health/ready` → `503`
with `checks.database.status: "down"`. Check the `[ops]` structured log
lines (or your `OPS_ALERT_WEBHOOK_URL` channel) for `scope: "chat.persistence"`
or `scope: "chat.org-lookup"` with `severity: "high"` — these are deduped to
one alert/minute per failure class, so a burst of them means a sustained
outage, not one flaky request.

**Immediate mitigation**: check the Supabase project's own status page/
dashboard first — this is almost always upstream, not app-level. There is no
app-level failover; the app already degrades as safely as it can (see §B of
the Supabase-outage hardening report: replies keep working, no duplicate
data on retry once the database returns, nothing is silently lost — a
degraded turn's data was never written, and the client is told so).

**Recovery verification**: `/api/health/ready` → `200`. Send one real chat
message through the widget and confirm the trailer no longer carries
`degraded: true` and a `conversationId` is returned. Check
`/api/internal/ops/summary` — backlog counts should start draining on the
next cron cycle, not stay flat.

**Escalate when**: the outage exceeds your data-loss tolerance for
in-flight (degraded) turns, or Supabase's own status page shows a
multi-region/prolonged event.

---

## 2. Anthropic outage / timeout / 429

**Symptoms**: chat replies show a friendly `chat.errors.busy` (429) or
`chat.errors.unavailable`/`chat.errors.serverError` (5xx/timeout) instead of
an AI reply. Lead extraction and the AI Sales Manager degrade to their own
safe fallbacks (never throw — see `PRODUCTION-HARDENING.md` §2).

**How to confirm**: check Anthropic's own status page. `[ops]` log lines
with `scope` values under `anthropic.*` (see `logEvent` call sites in
`src/lib/chat/anthropic.ts` and callers) show which call type and how often.
No dashboard graph exists yet for this — it's log-only (see remaining gaps).

**Immediate mitigation**: nothing to do at the infrastructure level — the
streamed chat reply never retries by design (`docs/PRODUCTION-HARDENING.md`
§2 explains why: a retry after partial streaming would duplicate output and
double-bill usage). Single-shot calls (extraction, AI Sales Manager) already
retry once automatically. If sustained, consider a temporary maintenance
banner on the marketing site — there's no in-app "chat disabled" toggle
today.

**Recovery verification**: send a real chat message, confirm a normal AI
reply streams back with no error banner.

**Escalate when**: Anthropic's own status page confirms a prolonged outage,
or 429s persist well past what your organization's usage tier should allow
(may indicate a quota/billing issue rather than a provider outage).

---

## 3. Google Calendar failure

**Symptoms**: chat conversations simply stop mentioning appointment
availability (the system prompt omits slots — `getAvailabilityForPrompt`
fails open, never throws, see `src/lib/chat/conversation-service.ts`). An
explicit booking attempt returns `errors.calendar.providerFailed` to the
visitor instead of confirming a slot.

**How to confirm**: check Google Workspace/Cloud status. `console.error`
line `"calendar availability lookup failed: ..."` in server logs (not yet
routed through `reportError`/`logEvent` — see remaining gaps) for the
specific provider error.

**Immediate mitigation**: nothing at the infrastructure level — this fails
safe already (no double-booking risk, no silent data loss; a failed booking
attempt is never partially recorded). If sustained, tell affected customers
their calendar integration is temporarily degraded; the qualification chat
itself keeps working normally.

**Recovery verification**: trigger a chat that would normally show
availability and confirm slots appear again; attempt a real test booking
from the dashboard's "Settings → Integrations" test action if available.

**Escalate when**: Google's own status page confirms an extended outage, or
the failure persists after a token refresh would be expected to have
resolved it (may indicate a revoked/expired OAuth grant needing
reconnection, not a transient outage).

---

## 4. Integration Hub backlog

**Symptoms**: customer-configured webhooks stop receiving events promptly.
`GET /api/internal/ops/summary` (bearer `OPS_STATUS_SECRET`) shows
`integrationHub.pendingFanout` or `integrationHub.pendingDeliveries` growing
across polls, or `integrationHub.dead` climbing (repeated terminal
failures), or `integrationHub.stuckDelivering` nonzero across two
consecutive polls (a single crashed-and-reclaimed worker is normal;
persistent is not).

**How to confirm**: poll the ops summary route a few minutes apart and
compare. A single elevated read is not itself an incident — the cron runs
every minute; check the trend.

**Immediate mitigation**: confirm the cron is actually firing — check your
scheduler's own run history (Vercel Cron dashboard, or your external
scheduler's logs) for `POST /api/internal/integrations/run`. If it's firing
but not draining, check the customer endpoint(s) responsible — the delivery
worker auto-disables an endpoint after `AUTO_DISABLE_AFTER_FAILURES`
consecutive failures (`src/lib/integrations/config.ts`), which itself is a
signal, not a bug. Manually trigger a run: `curl -X POST
https://<domain>/api/internal/integrations/run -H "Authorization: Bearer
$INTEGRATION_HUB_CRON_SECRET"` and read the returned summary.

**Recovery verification**: `integrationHub.pendingDeliveries` and
`pendingFanout` trending back toward zero over a few cron cycles.

**Escalate when**: the backlog doesn't drain after confirming the cron
fires and manually triggering a run — likely a code-level or database-level
problem, not a transient blip.

---

## 5. Follow-up worker backlog

**Symptoms**: scheduled lead follow-ups (chat-proposed or manually
scheduled) aren't executing on time.

**How to confirm**: `GET /api/internal/ops/summary` →
`followUps.pendingDue` / `followUps.oldestDueSeconds` growing, or
`followUps.stuckProcessing` persistently nonzero, or `followUps.failed`
climbing.

**Immediate mitigation**: same shape as §4 — confirm the cron (`POST
/api/internal/follow-ups/run`, every 5 minutes) is actually firing via your
scheduler's run history; manually trigger it with the bearer secret if not.

**Recovery verification**: `followUps.pendingDue`/`oldestDueSeconds`
trending down; `oldestDueSeconds` should never exceed a small multiple of 5
minutes once healthy.

**Escalate when**: the backlog persists after confirming the cron runs and
a manual trigger — check for a channel-adapter-level failure (e.g. WhatsApp
credentials expired for many orgs at once) rather than a scheduler problem.

---

## 6. Cron not running at all

**Symptoms**: any of §4/§5's backlog signals growing indefinitely, or the
rate-limit cleanup route's own summary (`{deleted, retentionSeconds,
durationMs}`) never appearing in logs, or `rateLimitCleanup.staleCount`
(ops summary) nonzero and growing.

**How to confirm**: your scheduler's own dashboard/run history is the
source of truth — Vercel Cron (Project → Cron Jobs), or your external
scheduler's logs (GitHub Actions run history, etc.). Note: Vercel Cron on
the **Hobby plan only supports daily cadence** — the 1-minute/5-minute
routes will fail to deploy at all on Hobby (`docs/PRODUCTION-HARDENING.md`
§1). If a deploy silently reverted to Hobby-plan limits, that alone explains
"cron not running."

**Immediate mitigation**: manually `curl` the affected route with its
bearer secret to unstick the immediate backlog while you fix the scheduler
configuration. Verify `vercel.json`'s `crons` array actually matches what's
deployed (a stale `vercel.json` from before a route was added/renamed is a
classic cause).

**Recovery verification**: the scheduler's run history shows regular
invocations again; ops-summary backlog counts drain.

**Escalate when**: the scheduler shows successful invocations but the
backlog still isn't draining — that's §4/§5's failure mode, not this one.

---

## 7. Rollback after a bad deploy

**Symptoms**: error rate, timeout rate, or function duration spikes
immediately following a deploy; `/api/health/ready` starts failing where it
didn't before; a specific feature breaks that wasn't broken in the previous
deploy.

**How to confirm**: Vercel dashboard → Deployments → compare the error/
duration graphs before and after the suspect deploy's timestamp.

**Immediate mitigation**: **Vercel Instant Rollback** — Deployments →
select the last known-good deployment → "Promote to Production" (or `vercel
rollback` via CLI). This is immediate and safe: it only changes which
already-built deployment serves traffic, no rebuild, no database change.

**Database migrations are forward-only in this repo** (no down-migrations —
see `loadtest/FINDINGS.md` §16 item 7). If the bad deploy included a
migration that's incompatible with the rolled-back code:
1. Roll back the Vercel deployment first regardless — it stops the bleeding
   for anything not touching the new schema.
2. Assess whether the new migration is additive (new column/table with a
   default — old code ignoring it is safe) or breaking (renamed/dropped
   column — old code will error). Only the latter needs a follow-up
   forward-fix migration; write and apply one that restores compatibility,
   don't attempt to "undo" the migration file itself.
3. Never manually edit a migration file that has already been applied
   anywhere (local dev counts) — write a new one.

**Recovery verification**: error/duration graphs return to baseline;
`/api/health/ready` → `200`; a smoke test of the specific broken feature.

**Escalate when**: the issue persists after rollback (points to
infrastructure/config, not the deploy itself), or the rollback itself
reveals a migration incompatibility that needs a forward-fix before you can
safely roll forward again.
