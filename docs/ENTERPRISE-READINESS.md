# Enterprise readiness — authoritative backlog

The single running record of what enterprise-readiness work has actually
been done, verified, or is still open. Earlier phases recorded their
findings inline in `loadtest/FINDINGS.md` (§12/§13/§15/§16/§17) — that file
stays as the historical record of *how* each finding was produced (load
levels, measurements, failure-injection results), but **this file is now
the authoritative status list going forward**. When a phase closes an item
here, update its status in place; when a phase finds something new, add it
here. Don't delete a still-open item just because a later phase didn't
touch it.

Last updated: 2026-09-13 (Enterprise Operations Readiness — local-only phase).

---

## Status summary

| # | Item | Status | Since |
|---|---|---|---|
| 1 | Contact-based lead dedup concurrency-safety | **DONE** | Enterprise Readiness load-test phase, commit `8a1db34` |
| 2 | Silent lead loss during a Supabase outage | **DONE** | Supabase Outage Hardening phase |
| 3 | Horizontal scaling validated on real Vercel infra | **PAUSED** (no paid infra yet) | Enterprise Readiness load-test phase |
| 4 | Staging environment (separate Vercel + Supabase project) | **PAUSED** (no paid infra yet) | Staging planning phase |
| 5 | Health/liveness endpoint | **DONE** | Enterprise Operations Readiness (this phase) |
| 6 | DB readiness endpoint | **DONE** | Enterprise Operations Readiness (this phase) |
| 7 | Ops backlog summary endpoint | **DONE** | Enterprise Operations Readiness (this phase) |
| 8 | Follow-up scheduler backlog visibility | **DONE** | Enterprise Operations Readiness (this phase) |
| 9 | Integration Hub backlog visibility | **DONE** | Enterprise Operations Readiness (this phase) |
| 10 | Rate-limit cleanup staleness visibility | **DONE** | Enterprise Operations Readiness (this phase) |
| 11 | Incident-response runbook | **DONE** | Enterprise Operations Readiness (this phase) |
| 12 | Backup/restore documentation | **DONE (documented)** — restore drill NOT performed | Enterprise Operations Readiness (this phase) |
| 13 | `safe-fetch` hostname/DNS lookup bug (Happy-Eyeballs `lookup` contract) | **DONE (fixed)** | Enterprise Operations Readiness (this phase) |
| 14 | Playwright browser-test lane (dashboard concurrency, AI Sales Manager latency) | **NOT BUILT** — assessed only | first flagged: load-test phase; assessed: this phase |
| 15 | Restore drill | **NOT PERFORMED** | this phase (documentation only) |
| 16 | Alert dedup is in-memory/per-warm-process only | **DEFERRED** | Supabase Outage Hardening phase |
| 17 | Authenticated-member / anonymous-demo org paths lack a `degraded` signal | **DEFERRED** | Supabase Outage Hardening phase |
| 18 | Retried chat turn can show a duplicate message in the visible transcript | **DEFERRED** | Supabase Outage Hardening phase |
| 19 | No error-tracking vendor (Sentry/Datadog) wired | **DEFERRED (by design)** | Production Hardening phase |
| 20 | Secret rotation procedure/cadence undocumented | **DEFERRED** | load-test phase (§15 checklist) |
| 21 | Calendar availability errors use `console.error`, not `reportError`/`logEvent` | **DEFERRED** | noticed during this phase, not fixed |
| 22 | Google Calendar failure injection (429/timeout) not exercised | **NOT TESTED** — no injection point without modifying the app's built-in mock transport | load-test phase, still true |
| 23 | `calendar/service.integration.test.ts` flaky/shared-state behavior | **UNRESOLVED** | first observed: Supabase Outage Hardening phase re-verification; reconfirmed: this phase |
| 24 | AI Sales Manager query latency under load | **NOT TESTED** — Server Action wire protocol not replicated by the k6 harness | load-test phase |
| 25 | Dashboard concurrent-session behavior above 10 VU | **NOT VALIDATED** — harness artifact, not a confirmed app bug | load-test phase |

---

## DONE — this phase (Enterprise Operations Readiness, local-only)

- **Health/liveness endpoint** — `GET /api/health`. Always `200` when
  reachable; checks nothing (no DB, no Anthropic) by design. Public, no
  session/secret.
- **DB readiness endpoint** — `GET /api/health/ready`. One cheap, bounded,
  row-less query; `200` ok / `503` degraded with a safe error
  classification only. Required adding `/api/health*` to the proxy's
  public-path allowlist (`src/lib/auth/route-policy.ts`) — verified with a
  live smoke test against a running server (no more redirect-to-`/login`).
- **Ops backlog summary endpoint** — `GET/POST /api/internal/ops/summary`,
  bearer-secret gated (`OPS_STATUS_SECRET`, same shape as the cron routes).
  Full auth contract (unconfigured / no credential / wrong credential /
  correct credential) explicitly proven — see the accompanying report's §A
  and `route.test.ts` + `route.integration.test.ts`.
- **Follow-up scheduler backlog visibility** — `follow_up_backlog_summary`
  SQL function: pending-due, stuck-processing, failed, oldest-due-age. No
  new table — derived from `lead_follow_ups`' existing bookkeeping columns.
- **Integration Hub backlog visibility** — `integration_hub_backlog_summary`
  SQL function: pending-fanout, pending-deliveries, stuck-delivering, dead,
  oldest-pending-age. Derived from `integration_event_outbox` /
  `integration_deliveries`.
- **Rate-limit cleanup staleness visibility** — `rate_limit_backlog_summary`
  SQL function: count of `private.rate_limits` rows well past the cleanup
  cron's own retention window.
- **Incident-response runbook** — `docs/INCIDENT-RUNBOOK.md`: 7 scenarios
  (DB outage, Anthropic outage/429, Calendar failure, Integration Hub
  backlog, follow-up backlog, cron not running, bad-deploy rollback), each
  with symptoms / how-to-confirm / mitigation / recovery-verification /
  escalate-when, grounded in the actual fail-open code paths.
- **Backup/restore documentation** — `docs/BACKUP-RESTORE.md`: what needs
  backing up (including the encryption-key-vs-database split for at-rest
  token encryption), Supabase backup-tier caveats, an 8-step restore
  verification checklist, migration-compatibility notes. Explicitly marked
  as **not drilled**.
- **`safe-fetch` hostname/DNS lookup bug — fixed.** Root cause was broader
  than the original "localhost only" P2 note: Node's Happy-Eyeballs
  (`autoSelectFamily`, default since Node 20) calls a custom `lookup` hook
  with `{ all: true }` expecting an array reply; `pinnedPost`'s hook always
  answered with a single address, silently breaking **every** Integration
  Hub webhook delivery to a non-IP-literal hostname (not just `localhost` —
  every existing test happened to use a literal IP, which skips the hook
  entirely, so this was never caught). Fixed in `src/lib/integrations/
  safe-fetch.ts`; SSRF pinning behavior unchanged (still only ever returns
  pre-validated addresses). New regression tests exercise the real Node
  `lookup` hook against a real server.

## PARTIAL / DEFERRED / NOT TESTED

**Not performed / not built this phase (or ever):**
- **Restore drill** — not performed. `docs/BACKUP-RESTORE.md` is
  documentation of what *should* happen, not a verified procedure.
- **Playwright browser-test lane** — not built. Assessed as the smallest
  clean setup for later (one new devDependency, two spec files: dashboard
  concurrent-session auth, and the Ask LeadFlow Server Action latency path)
  but deliberately not implemented — real new test infrastructure, not a
  tiny addition.
- **Real Vercel/Supabase staging + horizontal-scaling validation** — paused
  per explicit instruction. No paid infrastructure created. See the staging
  architecture report from the staging-planning phase for the full plan
  (separate Vercel project, separate Supabase project, GitHub Actions as
  the external load generator, a second lightweight Vercel project for the
  Anthropic/webhook mock host) — ready to execute once approved.
- **Google Calendar failure injection (429/timeout)** — still not
  exercised. The app's built-in `CALENDAR_MOCK_TRANSPORT` has no
  failure-injection hook, and adding one means modifying application code,
  which every load-test phase to date has deliberately avoided. Still an
  open gap, not newly introduced or newly closed by this phase.

**Noticed but intentionally not fixed this phase (would be scope creep):**
- **Calendar availability errors still use `console.error`** instead of
  the unified `reportError`/`logEvent` path everything else on the hot path
  uses (`src/lib/chat/conversation-service.ts`'s
  `getAvailabilityForPrompt` catch block). Noticed while writing the
  incident runbook. Small, isolated, and safe to fix in a future pass —
  deliberately left alone here rather than expanding this phase's scope.
- **`calendar/service.integration.test.ts` has unresolved flaky/
  shared-state behavior.** First observed during the Supabase Outage
  Hardening phase's verification pass (`rescheduleAppointment` failing);
  reconfirmed this phase with a *different* failing sub-test
  (`cancelAppointment`) on a clean, unmodified checkout via `git stash` —
  confirming it's pre-existing test-ordering/shared-state flakiness in that
  file, not a regression from any recent change, and not yet root-caused.

**Carried forward from earlier phases, untouched by this one:**
- **Alert dedup is in-memory/per-warm-process only** — resets on cold
  start, doesn't dedupe across serverless instances (Supabase Outage
  Hardening phase; accepted limitation, not a defect).
- **Authenticated-member and bare-anonymous/demo chat paths don't emit a
  `degraded` signal** the way the widget-key path does — they already fail
  open to a config-only chat on a resolution error (same "nothing was ever
  going to persist" semantics as `not_configured`), just without the
  explicit signal (Supabase Outage Hardening phase).
- **A retried chat turn can show a duplicate message in the visible
  transcript** — the underlying data is never duplicated (retry reuses the
  original `requestId`), only the client-side render before the retry
  resolves (Supabase Outage Hardening phase).
- **No error-tracking vendor (Sentry/Datadog) wired** — deliberate, by
  design, per the Production Hardening phase: the integration point
  (`onRequestError` in `src/instrumentation.ts`) exists; no SDK is
  installed until there's an actual provider account to point it at.
- **Secret rotation procedure/cadence is undocumented** — `docs/
  PRODUCTION-SECURITY.md` documents which secrets exist and how to generate
  them, not a rotation cadence or procedure (load-test phase §15 checklist).
- **AI Sales Manager ("Ask LeadFlow") query latency under load** — entirely
  untested; it's a Next.js Server Action, not a REST route, and the k6
  harness's wire protocol doesn't replicate it (load-test phase).
- **Dashboard concurrent-session behavior above 10 VU** — not validated; a
  hand-built session cookie showed intermittent failures under the k6
  harness specifically, most likely a harness artifact rather than a
  confirmed app defect, but not distinguished either way (load-test phase).

---

## Provenance (which phase produced which finding)

1. **Enterprise Readiness load-test phase** (`loadtest/FINDINGS.md`) — the
   original load/failure-injection pass: found and fixed the lead-dedup
   concurrency race; found (did not fix) the Supabase-outage silent-loss
   issue, the single-process CPU ceiling, the Playwright-shaped gaps, and
   the original `safe-fetch` "localhost" observation.
2. **Supabase Outage Hardening phase** — closed the silent-lead-loss
   finding (`degraded` signal, failure-contract refactor, idempotent-retry
   proof); recorded 3 accepted limitations, all still open (#16–18 above).
3. **Staging architecture planning phase** — designed (not yet executed)
   the separate-Vercel/separate-Supabase staging plan; discovery confirmed
   no Vercel/Supabase CLI session is authenticated in this environment and
   no production project is identifiable from repo state.
4. **Enterprise Operations Readiness phase** (this phase) — closed the
   health-endpoint, backlog-visibility, runbook, and backup-doc gaps;
   escalated the `safe-fetch` P2 note into a real, fixed bug; explicitly
   proved the new ops-summary endpoint's auth contract.
