# Production hardening

Operational specifics added in the Production Hardening phase: scheduled jobs,
the Anthropic timeout/retry policy, structured observability, the
error-tracking integration point, default AI usage caps, and rate-limit
counter cleanup. For secrets/RLS/auth hardening, see
**`docs/PRODUCTION-SECURITY.md`**; for the pilot checklist, see
**`docs/PILOT-SETUP.md`**.

## 1. Scheduled jobs (cron)

Three routes, all following the same pattern: unauthenticated by default (a
missing secret env var → `503`), otherwise gated by a server-only bearer
secret checked in constant time (`checkCronSecret`, `src/lib/follow-ups/
auth.ts` — shared by all three), never logged. Each accepts `GET` and `POST`
so any scheduler works, and returns a small JSON summary (counts + a run/
request id), never a secret or lead data.

| Route | Secret env var | Cadence | Why |
| --- | --- | --- | --- |
| `POST /api/internal/follow-ups/run` | `FOLLOW_UP_CRON_SECRET` | `*/5 * * * *` (every 5 min) | Lead follow-up scheduler |
| `POST /api/internal/integrations/run` | `INTEGRATION_HUB_CRON_SECRET` | `* * * * *` (every 1 min) | Integration Hub outbox fan-out + webhook delivery/retry |
| `POST /api/internal/rate-limits/cleanup` | `RATE_LIMIT_CLEANUP_CRON_SECRET` | `0 3 * * *` (daily, 03:00 UTC) | Garbage-collects stale `private.rate_limits` rows |

`vercel.json` already declares all three under `crons` for a Vercel
deployment. If deploying elsewhere, point any scheduler (Supabase Cron,
GitHub Actions, a plain `cron` + `curl`) at the same routes with
`Authorization: Bearer <secret>`.

### Vercel plan requirement — verified against Vercel's docs (2026-08/09)

Vercel Cron Jobs: **Hobby is limited to once-per-day cadence** (a more
frequent expression fails at deploy time — "Hobby accounts are limited to
daily cron jobs"); **Pro and Enterprise support down to once per minute**, up
to 100 cron jobs per project on every plan.

- `follow-ups/run` (every 5 min) and `integrations/run` (every 1 min) both
  **require Vercel Pro or Enterprise**. This was already true before this
  phase (`follow-ups/run` already ran every 5 minutes) — this phase does not
  change the plan requirement, it just adds a second cron at the same
  requirement.
- `rate-limits/cleanup` (once daily) works on **Hobby** too.

**If deploying on Vercel Hobby:** do not rely on `vercel.json`'s `crons` for
the two frequent routes — the deploy will fail validation. Either upgrade to
Pro, or drive `follow-ups/run` and `integrations/run` from an external
scheduler (GitHub Actions on a schedule trigger, Supabase Cron, or any host
that can `curl` on an interval) instead of Vercel's own cron — the routes
themselves don't care who calls them, only that the bearer secret is correct.

### Delivery latency note

The Integration Hub's retry backoff starts at 30s (`src/lib/integrations/
config.ts`). A 1-minute worker cadence means a retry is picked up within
about a minute of becoming due, not the instant it's due — acceptable for a
webhook delivery queue; tighten to 30s only if a customer integration
specifically needs it (Pro plan still required either way).

## 2. Anthropic timeout, retry & cancellation policy

Every Anthropic call goes through `src/lib/chat/anthropic.ts`'s two helpers
instead of ad hoc options:

| Helper | Used by | Timeout | Retries | Cancellation |
| --- | --- | --- | --- | --- |
| `streamCallOptions(signal)` | `/api/chat`'s streamed reply | `ANTHROPIC_STREAM_TIMEOUT_MS` (default 30s) | **0, always** | inbound request's `AbortSignal`, when available |
| `requestCallOptions(signal?)` | lead/action extraction, WhatsApp reply generation, AI Sales Manager planner + answer | `ANTHROPIC_REQUEST_TIMEOUT_MS` (default 20s) | `ANTHROPIC_REQUEST_MAX_RETRIES` (default 1) | threaded where a signal is available, omitted otherwise |

The Anthropic client itself is constructed with `maxRetries: 0`
(`getAnthropicClient`), so nothing retries unless a call site explicitly asks
via `requestCallOptions`.

**Why the streamed reply never retries:** by the time a retry could happen,
some of the reply may already have been streamed to the client (and, once the
usage-metering write for the first attempt lands, billed). A blind SDK retry
of a `messages.stream()` call would duplicate output and could double-record
usage. A client-visible failure there surfaces as a friendly error
(`chat.errors.*`) instead — the existing behavior, unchanged.

**Why single-shot calls get a small retry budget:** lead extraction, the
WhatsApp reply, and the AI Sales Manager's planner/answer calls are each one
idempotent structured-output request with nothing already shown to a caller —
a bounded retry (default 1, i.e. at most 2 attempts) absorbs a transient
network blip without risking a retry storm. All four already have a "never
throws, returns a safe empty/fallback result" contract, unchanged by this
phase — a timeout just makes that fallback trigger sooner instead of after
the SDK's 10-minute default.

**Headroom:** both timeouts are comfortably under the platform function
timeout (**300s default** on Vercel with fluid compute, the current default
for every plan — see `docs/functions/limitations` on vercel.com, verified
2026-08-24) and under the browser's own 45s give-up for `/api/chat`
(`REQUEST_TIMEOUT_MS` in `src/lib/chat/api-assistant.ts`, pre-existing).

**Cancellation:** `/api/chat` passes the inbound `NextRequest`'s `AbortSignal`
into both the streamed reply call and the follow-up extraction call. This is
best-effort — the platform's own request lifecycle determines whether that
signal actually fires on a client disconnect once the response has started
streaming — but it costs nothing when it doesn't fire, and stops real waste
(an abandoned Anthropic call) when it does. The WhatsApp webhook and the AI
Sales Manager have no inbound request to cancel against (fire-and-forget /
server-action contexts respectively) — they rely on the timeout alone.

All four env vars are optional; unset falls back to the defaults above:
`ANTHROPIC_STREAM_TIMEOUT_MS`, `ANTHROPIC_REQUEST_TIMEOUT_MS`,
`ANTHROPIC_REQUEST_MAX_RETRIES`.

## 3. Structured observability

`src/lib/observability/log.ts`'s `logEvent(fields)` — one JSON line to
stdout per call, redacted the same way `reportError` is (never a secret, a
message body, or a lead field — only ids, counts, statuses, durations).
Every host that captures stdout already has these logs; no vendor SDK.

**requestId propagation:**

- `/api/chat` — `parsed.requestId` (client-supplied) when present, otherwise
  a fresh `crypto.randomUUID()` generated once per request purely for log
  correlation. This is **distinct** from the metering/persistence idempotency
  key, which is always exactly what the client sent (or `null`) — unchanged.
- WhatsApp webhook — a per-message `requestId` was already deterministic
  (`uuidFromProviderId(message.providerMessageId)`, `src/lib/whatsapp/
  inbound.ts`) and doubles as the metering key; the route also generates one
  `requestId` per webhook **batch** for the summary log line.
- Integration worker — already generated a per-run `runId`
  (`src/lib/integrations/worker.ts`); now every log line in that run uses it,
  via `logEvent`, instead of a mix of `console.log`/`reportError`.

**`organizationId`** is included wherever it's already resolved and safe (it
never carries the org's *name* or any lead data, just the id) — omitted only
where the call genuinely has no org context (the anonymous/demo chat path,
the Google Calendar HTTP transport layer, which is intentionally
organization-blind).

**`durationMs`** is recorded for:
- every Anthropic call (`anthropic.chat_reply`, `anthropic.lead_extraction`,
  `anthropic.sales_manager_plan`, `anthropic.sales_manager_answer`)
- every Google Calendar API call (`calendar.google.freeBusy` /
  `insertEvent` / `patchEvent` / `deleteEvent`, in
  `src/lib/calendar/google/client.ts`)
- the major DB/persistence operations on the hot paths:
  `db.persist_completed_turn` (chat + WhatsApp), `db.integrations_fanout`,
  `db.claim_integration_deliveries`, `db.rate_limit_cleanup`.

**Never logged:** API keys/tokens/secrets (redacted by pattern, same rule as
`reportError`), chat/message content, and lead PII (name, phone, email,
`customData`) — only counts, ids, statuses, and durations ever go into a
`logEvent`/`reportError` call.

## 4. Error-tracking integration point

`src/instrumentation.ts` now also exports `onRequestError` — Next.js's own,
vendor-agnostic hook (stable since Next 15; see `node_modules/next/dist/docs/
01-app/03-api-reference/03-file-conventions/instrumentation.md`), called for
any server error that reaches Next's own boundary (a Server Component, a
Server Action, or an uncaught throw in a Route Handler). It forwards to the
existing `reportError` sink, so it needs no new configuration — it just picks
up `OPS_ALERT_WEBHOOK_URL` like everything else.

This is a **backstop**, not the primary path: `/api/chat`, the WhatsApp
webhook, and the integration worker already catch and report their own
errors with richer context (`requestId`, `organizationId`, phase). This hook
catches what they don't — a bug outside those try/catches, a dashboard page
render error, an uncaught Server Action error.

**To add a real error-tracking provider** (Sentry, Datadog, etc.) — not done
here, no SDK is installed:

1. `npm install @sentry/nextjs` (or your provider's SDK) and follow its Next.js
   setup (it will want its own `instrumentation.ts` hooks too — merge with
   the existing `register`/`onRequestError` exports rather than replacing the
   file).
2. In `onRequestError`, also call the provider's capture function (e.g.
   `Sentry.captureRequestError(error, request, context)`) alongside — or
   instead of — `reportError`.
3. Set the provider's DSN/API key as a server-only env var.

Kept minimal deliberately, per the "no unnecessary dependencies" rule — add
the SDK when there's an actual provider account to point it at.

## 5. Default AI usage caps

New organizations are no longer unlimited by default. `src/lib/org/
onboarding.ts` calls `ensureDefaultUsageLimits` (`src/lib/metering/
default-limits.ts`) once, immediately after `create_organization_with_owner`
succeeds — it `INSERT`s (never upserts) a default row into the existing
`organization_usage_limits` table (Phase O metering; no schema change). Once
that row exists, the existing `checkUsageAllowed` gate and dashboard usage
page treat it exactly like any owner-configured limit — no enforcement-logic
change.

**Scope, deliberately narrow:**
- Only **new** organizations get this row. An organization created before
  this shipped, with no row, is untouched (unlimited, as it always was) —
  this phase does not retroactively cap existing orgs.
- An org that already has **any** row — an explicit owner-configured limit,
  or (on a retried/duplicate onboarding call) a previous default — keeps it.
  The insert hits the `organization_id` primary key and fails harmlessly
  (Postgres `23505`), which is swallowed, never overwriting.
- Best-effort: if the insert fails for any other reason, org creation still
  succeeds (the org is left unlimited, the failure is reported via
  `reportError`) — consistent with the rest of the metering module's
  fail-open design (the usage gate itself already fails open on error).

**Defaults** (env-configurable, `src/lib/metering/default-limits.ts`):

| Env var | Default | Meaning |
| --- | --- | --- |
| `DEFAULT_MONTHLY_TOKEN_LIMIT` | 5,000,000 | tokens/month |
| `DEFAULT_MONTHLY_REQUEST_LIMIT` | 10,000 | Anthropic calls/month |
| `DEFAULT_MONTHLY_COST_LIMIT_USD` | 50 | USD/month |
| `DEFAULT_USAGE_WARNING_THRESHOLD_PERCENT` | 80 | dashboard warning band |
| `DEFAULT_USAGE_HARD_LIMIT_ENABLED` | `true` | whether the cap actually blocks, not just warns |

`DEFAULT_USAGE_HARD_LIMIT_ENABLED` defaults to `true` deliberately — a
default limit that's merely advisory (dashboard-only) doesn't satisfy "must
not be unlimited by default." The numbers are intentionally generous (a
qualification chat's replies are small — see `MAX_TOKENS` in
`src/lib/chat/anthropic.ts`); raise or lower them per env without a code
change.

## 6. Rate-limit counter cleanup

`hit_rate_limit` (`src/lib/security/rate-limit.ts`, Pilot Hardening) never
deletes a `private.rate_limits` row — a counter for a key nobody has hit in
months just sits in the table forever. `public.cleanup_expired_rate_limits`
(migration `20260911120000_rate_limit_cleanup.sql`) deletes rows whose
`window_start` is older than a given number of seconds; it's pure garbage
collection, not a correctness dependency — `hit_rate_limit`'s `UPSERT`
re-creates any deleted key on its very next hit.

**Safety:** the SQL function itself enforces no minimum (by design — the
migration's own comment explains this is left to the caller, mirroring how
`hit_rate_limit` trusts its caller for `p_window_seconds`). The **only**
application caller, `src/lib/security/rate-limit-cleanup.ts` (driving the
cron route above), floors the retention at **1 hour** regardless of the env
var — comfortably above every current rule's window (the longest today is
`chat:org` at 3600s, see `src/lib/security/rate-limit.ts`), so an active
window is never touched by the real cron path. Default retention (unset env
var): **24 hours**. Override with `RATE_LIMIT_CLEANUP_RETENTION_SECONDS`.

The cleanup route/function is `service_role`-only, same as `hit_rate_limit` —
never reachable by `anon` or `authenticated`.
