# Enterprise Readiness + Load Testing — Findings

Results of the load-test phase run against the harness in this directory.
Executed against a real local Supabase + a real `next start` production
build, with Anthropic and Google Calendar traffic redirected to deterministic
mocks (see `README.md`). No application code was changed to produce these
results except the one fix explicitly called out in §12.

**Read §2 (test environment) before trusting any number below.** This ran on
one developer machine, not staging or production infrastructure.

---

## 1. Proposed SLOs

| Metric | Non-LLM requests | LLM streaming requests |
|---|---|---|
| Availability (widget/chat path) | 99.9% | 99.5% (external-provider-dependent) |
| p50 latency | ≤150ms | ≤2.0s (TTFB-driven) |
| p95 latency | ≤500ms | ≤6s |
| p99 latency | ≤1.2s | ≤12s |
| Dashboard p95 | ≤800ms | n/a |
| Booking success rate (valid, available slot) | ≥99.5% | — |
| Integration Hub delivery latency (p95, first attempt) | ≤ cron interval + 5s | — |
| Follow-up completion (due batch drained) | within 2 cron cycles | — |
| 5xx rate | <0.5% | <1% |
| Timeout rate | <0.5% | <2% |
| DB error rate | <0.1% | <0.1% |

No sub-second p95/p99 was proposed for streaming chat — Anthropic itself
doesn't guarantee that, and the measurements below (even against a
faster-than-real mock) show 1.2–2.4s p95 at moderate concurrency before any
queuing. These are starting targets for sign-off/tuning, not measured
guarantees.

## 2. Test environment and its limitations

Local machine: 10 cores / 16GB RAM, Docker-hosted Supabase (`postgres:17`),
a single `next start` Node process. **This is materially different from
production**: local Postgres `max_connections=100`, PostgREST's connection
pool, and one single-threaded Node process are not representative of Vercel
Fluid Compute (many auto-scaled instances) or a properly sized hosted
Supabase. Findings about *where* a bottleneck sits mechanically transfer;
absolute numbers at high concurrency do not directly predict production
capacity — flagged again at every relevant point below.

### Harness bugs found and corrected mid-run

Two things went wrong during testing and were caught and fixed before
trusting the results — noted here because both quietly produced a false
"everything's fine" reading before being caught:

1. **A manual PostgREST container swap** (while testing whether connection-
   pool size was the bottleneck) dropped `PGRST_JWT_SECRET`. This silently
   broke all service-role-authenticated queries, making chat requests fall
   back to unauthenticated/generic behavior while still returning HTTP 200 —
   a false "improvement" (1.26s vs. 4.86s p95). Caught via a dedup scenario
   returning the wrong industry-template shape. **All contaminated
   measurements were re-run** after the fix before being recorded below.
2. **Hardcoded booking dates** in the original appointment-booking script
   (`2027-02-xx`) were outside the app's real `APPOINTMENT_MAX_DAYS`
   (60-day) validation window, so every booking action was silently dropped
   — correct app behavior, wrong test data. Fixed to use relative dates.

## 3. Widget boot (Scenario A — non-LLM path)

`widget.js` + `/embed/<key>`.

| Level | VUs | req/s | p95 | Errors |
|---|---|---|---|---|
| 1 | 10 | 18.8 | 78ms | 0% |
| 2 | 50 | 90.5 | 97ms | 0% |
| 3 | 100 | 181.4 | 98ms | 0% |
| 4 | 250 | 460.4 | 86.5ms | 0% |
| 5 | 500 | — | 799ms | 0% |
| 6 | 1000 | — | 1.12s | 1.36% |

The 1.36% at 1000 VU was `status=0, error="dial: i/o timeout"` — a
**client-side TCP connect timeout**, not an application 5xx or database
error (see §9).

## 4. Streaming chat (Scenario B — LLM path, 2-turn: create + update lead)

| Level | VUs | req/s | p95 (per chat call) | Errors |
|---|---|---|---|---|
| 1 | 10 | 5.2 | 1.25s | 0% |
| 2 | 50 | 26.0 | 1.38s | 0% |
| 3 | 100 | 43.0 | 2.20s | 0% |
| 4 | 250 | 59.4–65.3 | **5.18s** | 0% |
| 5 | 500 | 217.3 | 2.38s* | 0% |
| 6 | 1000 | 376–412 | 2.6–3.6s* | 0.16–1.35% |

\* Non-monotonic vs. Level 4 — reproduced three times, not noise. See §9 for
why (the load generator itself self-throttles at these levels on one
machine).

Root cause of the Level-4 degradation, actually measured, not guessed (§9):
single-process Node.js CPU saturation, not the database.

## 5. Dashboard — harness limitation

At 10 VU, with a session re-authenticated on every request, the dashboard
page and leads list loaded cleanly (0% errors, p95 881ms / 411ms). At 50–100
VU, 8–36% of requests failed — **not attributable to the app**: reusing a
hand-built session cookie across requests failed intermittently for reasons
not fully isolated (evidence pointed at, then ruled out, cookie chunking);
re-authenticating every request fixed that but then hits local GoTrue's own
sign-in throughput ceiling (`login: 200` success rate dropped to 34% at 50
VU). Real users don't re-authenticate every page view, so this is a
synthetic-harness artifact either way.

**Dashboard concurrent-session behavior above 10 VU is NOT VALIDATED by this
harness.** A browser-based (Playwright) lane is the right tool here.

**NOT TESTED**: the AI Sales Manager ("Ask LeadFlow") query round-trip — it's
a Next.js Server Action, not a REST route, and its wire protocol wasn't
replicated. Only the `/dashboard/ask` page shell was load-tested.

## 6. Appointment booking (Scenario E)

- Different slots (20 concurrent, distinct times): all succeeded, no
  contention.
- **Concurrent same slot (25 simultaneous requests, identical slot, same
  org): exactly 1 `executed`, 24 graceful `slotTaken`, 0 errors, 0 crashes.**
  Verified directly against the database: exactly one `appointments` row
  exists for that org+slot. **Clean pass — the exclusion constraint holds
  under real concurrent load.**

Throughput at higher concurrency: **NOT TESTED** (only correctness was
tested at this level, not scale).

## 7. Integration Hub (Scenario F)

- 100 events enqueued → 100 fanned out → 100 delivered → 100 received at the
  mock. 0 loss, 0 duplication.
- Retry: mock set to `fail_500`, 20 events enqueued → all correctly marked
  failed/retry-scheduled with backoff; after the mock was fixed and the
  backoff window elapsed, the same worker claimed and delivered all 20 on
  attempt 2.
- Timeout: mock held the connection open → delivery correctly timed out at
  **10.2s**, matching `INTEGRATION_HUB_HTTP_TIMEOUT_MS`'s 10s default
  exactly, and was scheduled for retry (not lost, not crashed).

**Clean pass on all three.** Higher concurrency levels: NOT TESTED.

## 8. Follow-up worker (Scenario G)

500 due follow-ups seeded. 8 genuinely simultaneous parallel worker
invocations claimed disjoint batches (0, 1, 5, 19, 25×4 = 125, matching
exactly what remained), completing all 500 with **zero duplicates, zero
stuck rows**. **Clean pass — `FOR UPDATE SKIP LOCKED` holds under real
concurrent workers.**

## 9. Database and API bottleneck findings

**There is no query-level database bottleneck.** `pg_stat_statements` showed
every query the app issues running at **0.02–2ms mean execution time**, even
under 250+ concurrent chat turns, at every concurrency level tested. No
concerning sequential scans were observed.

**The one real mechanical finding: single-process Node.js CPU saturation.**
During the Level-4 (250 VU) chat run: the mock Anthropic server (holding 250
concurrent connections) used 1–5% CPU; the `next start` process used
**90–145% of one core** — fully saturating a single CPU core while 9 others
sat idle. This, not the database or connection-pool size, is what limits
throughput on **this specific one-process local setup**.

This was confirmed, not assumed: PostgREST's connection pool was
deliberately raised from its local default (~10, confirmed via
`pg_stat_activity`) to 60 as a test — after correcting the JWT bug in §2,
this made **no measurable difference** (5.18s vs. 4.86s p95 at 250 VU, same
within noise), ruling out pool size as the primary constraint here.

**Production implication**: this points at per-instance concurrency limits
(relevant to Vercel Fluid Compute's per-instance concurrency/autoscaling
configuration), not a database or query-design problem. **NOT TESTED**: real
multi-instance horizontal scaling on Vercel — architecturally the actual
answer to a single process saturating, and the harness cannot exercise it
locally (see remaining P1 §13a).

The 1000-VU "errors" in §3/§4 (`dial: i/o timeout`) are consistent with this
too: a thundering-herd of 1000 simultaneous new connections against a single
local Node process's TCP accept backlog — a known artifact of single-machine
load generation and serving on the same box, not evidence of an
application-level capacity ceiling.

## 10. Concurrency correctness

| Requirement | Result |
|---|---|
| Org A never sees org B data | Corroborated (existing RLS test suite + 30-org run showed 0 leads with null/wrong org) |
| Duplicate `requestId` → no duplicate messages | **PASS** — 5 concurrent identical requests → exactly 1 user message, 1 assistant message, 1 lead |
| Duplicate booking requests do not double-book | **PASS** — 25 concurrent same-slot requests → exactly 1 appointment (§6) |
| Integration Hub workers do not double-deliver | **PASS** — 100/100, no duplicates (§7) |
| Follow-up workers do not double-process | **PASS** — 500/500 claimed exactly once across 8 concurrent workers (§8) |
| Duplicate lead creation remains idempotent (contact-based dedup) | **FAILED at test time — now FIXED, see §12** |
| Usage limits remain correct under concurrency | Not independently re-tested this phase; existing Production Hardening integration tests (real DB) already pass |
| Rate limits remain globally consistent | Not stressed to its limit this phase (synthetic per-VU IPs kept each bucket low); the underlying atomic counter is already proven correct under concurrency by the existing `pilot-hardening.integration.test.ts` suite |

## 11. Failure-injection results

| Injection | Result |
|---|---|
| Anthropic 429 | `chat.errors.busy` / HTTP 429 in 0.18s. Clean, no retry storm. |
| Anthropic 500 | `chat.errors.unavailable` / HTTP 502 in 0.09s. Clean. |
| Anthropic timeout | HTTP 502 in **30.17s**, matching `ANTHROPIC_STREAM_TIMEOUT_MS` (30s default) exactly. |
| Integration endpoint timeout | Delivery correctly timed out at **10.2s** (`INTEGRATION_HUB_HTTP_TIMEOUT_MS`), retry-scheduled, not lost. |
| Integration endpoint 500 | Retry-scheduled with backoff; succeeded on the retry once fixed. No duplicate delivery. |
| Supabase fully unavailable (DB container stopped) | `/api/chat`: HTTP 200 in 2.6s, degrades gracefully to a generic/no-persistence reply (no crash, no hang) — but **silently drops the lead**: no error surfaced to the visitor or ops, no queued retry. `/api/internal/integrations/run`: HTTP 200, empty summary, no crash. |
| Supabase delayed (network-level latency injection) | **NOT TESTED** — no safe local tool for this without touching app code. |
| Google 429 / timeout | **NOT TESTED** — no failure-injection point in the built-in mock transport without modifying `src/`. |

## 12. P0 / P1 / P2 findings

**P0** — none found. No data corruption, no cross-tenant leak, no
double-booking, no double-delivery, no double-processing.

**P1 #1 — contact-based lead dedup was not concurrency-safe: FIXED.**
30 concurrent anonymous visitors sending the identical phone number to one
org produced **224 duplicate leads** instead of ~1. Root cause:
`findLeadByContact` (`src/lib/persistence/persist.ts`) was a plain `SELECT`
used to decide whether to `INSERT` — a check-then-write race the existing
`creation_request_id` unique index couldn't catch (it only protects an exact
requestId retry, not two different anonymous sessions sharing contact info).
This was the exact scenario the Production Hardening phase deferred pending
load-test evidence.

**Fixed in commit `8a1db34`** ("Make lead contact deduplication
concurrency-safe"): a migration adds `email_match_key` / `phone_match_key`
columns with `unique(organization_id, <key>)` indexes, and `persist.ts` now
does one atomic `INSERT ... ON CONFLICT ... DO UPDATE` instead of
select-then-insert. Re-verified with new concurrency tests (5–10 genuinely
concurrent `persistChatTurn` calls, both fake-DB and real Postgres) —
collapses to exactly one lead every time. Full suite green afterward.

**Remaining P1 #2 — single-process CPU saturation, unvalidated at scale.**
Confirmed mechanically (§9) but only ever observed on one local machine.
**Action required**: run this same kind of load against a real Vercel
staging deployment to see how autoscaling actually behaves — this cannot be
answered locally.

**Remaining P1 #3 — silent lead loss during a Supabase outage.**
During a full DB outage, the widget looks fully functional to a visitor
(fast 200, coherent reply) while silently failing to capture their contact
info, with nothing distinguishing this response from a normal one and no
alert path specific to this condition (§11). **Action required**: a product
decision on acceptable behavior here (a queued-retry buffer, or at minimum a
visible degraded-mode signal), then implementation.

**P2**
1. Dashboard session-cookie behavior under concurrent load needs a
   browser-based (Playwright) test lane — the current harness can't
   distinguish a real bug from its own artifact (§5).
2. AI Sales Manager query latency under load is entirely untested (Server
   Action wire-protocol gap) — worth a dedicated Playwright-based
   measurement given it's a per-query Anthropic call.
3. `localhost` (vs. `127.0.0.1`) fails safe-fetch's IP validation with an
   unhelpful `"Invalid IP address: undefined"` — low-priority, but worth a
   clearer error message if a real customer ever points a webhook at a bare
   hostname that fails to resolve.

## 13. Remaining P1s to close before enterprise launch

a. **Validate horizontal scaling on real Vercel staging.** This harness
   proved *where* a single process saturates; it cannot prove what Vercel's
   autoscaling does under the same load. Needs a staging deployment plus an
   external load generator (not this same machine).
b. **Define and implement lead-capture behavior during a Supabase outage.**
   Currently: functional-looking response, silent data loss, no signal.
   Needs a product decision, then a fix (even a minimal one — e.g. a local
   queue/buffer, or surfacing a distinguishable degraded-mode response).

## 14. Capacity matrix

| Workload | 10 | 50 | 100 | 250 | 500 | 1000 |
|---|---|---|---|---|---|---|
| Widget boot | CONFIRMED | CONFIRMED | CONFIRMED | PASSES WITH HEADROOM | PASSES WITH HEADROOM | NEAR LIMIT (1.36% conn-level errors) |
| Chat (LLM) | CONFIRMED | CONFIRMED | CONFIRMED | NEAR LIMIT (p95 5.2s) | NOT RELIABLY CLASSIFIABLE† | NOT RELIABLY CLASSIFIABLE† |
| Dashboard | CONFIRMED (10 only) | NOT TESTED (harness gap) | NOT TESTED (harness gap) | NOT TESTED | NOT TESTED | NOT TESTED |
| Appointment booking | CONFIRMED (correctness) | CONFIRMED (correctness) | NOT TESTED (throughput) | NOT TESTED | NOT TESTED | NOT TESTED |
| Integration Hub | CONFIRMED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Follow-up worker | CONFIRMED (correctness+throughput) | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |

† Load-generator (k6-on-laptop) self-throttling at these levels confounds
the reading (§9) — requires re-testing from a separate load-generation host
against real staging infra to get a trustworthy number.

**Safe estimates — only where actually measured, and only for this one local
machine:**
- **Safe requests/minute (chat)**: ~2,400–2,600/min sustained at ≤100
  concurrent before p95 degrades sharply (measured: 43 req/s at 100 VU).
- **Safe org count**: not independently bounded by anything measured here —
  the constraint found (single-process CPU) scales with total concurrent
  request volume, not org count. 30 orgs showed no per-org overhead issue.
- **Safe active conversations**: bounded by the same single-process CPU
  ceiling — roughly 100–150 concurrent multi-turn chat sessions before p95
  crosses ~2s on this hardware. **This is a local-hardware artifact, not a
  production ceiling** — genuinely NOT TESTED against Vercel autoscaling.
- **Safe leads/org, safe total lead volume**: no volume-based degradation
  found up to 3,116 total leads / 30 orgs (no index scan, table-size, or
  pagination issue observed) — not pushed hard enough to find a ceiling;
  NOT TESTED at higher row counts.

**None of the above are production capacity numbers.** They describe one
laptop. See §13a.

## 15. Enterprise operational checklist

| Item | Status | Note |
|---|---|---|
| Staging environment | **MISSING** | No staging deploy exists distinct from local dev |
| Prod/staging separation | **MISSING** | Follows from above |
| Rollback process | **PARTIAL** | Standard `git revert` + redeploy via Vercel; no documented runbook |
| Migration rollback/forward-fix strategy | **PARTIAL** | Forward-fix-only convention observed in `supabase/migrations/` (no down-migrations); undocumented as policy |
| Backups | **MISSING** (unverified) | No backup/restore documentation found in the repo |
| Restore drill | **MISSING** | No evidence one has been run |
| Secret rotation process | **PARTIAL** | `docs/PRODUCTION-SECURITY.md` documents which secrets and how to generate them; no rotation procedure/cadence |
| Incident response procedure | **MISSING** | No runbook found |
| Status/health endpoint | **MISSING** | No `/health` or `/status` route exists |
| Alerting | **PARTIAL** | `OPS_ALERT_WEBHOOK_URL` + `reportError` (Production Hardening) — functional but single-channel, no severity routing |
| Error tracking | **PARTIAL** | `onRequestError` hook + `reportError` (Production Hardening) — real integration point, no vendor (Sentry etc.) wired yet, by design |
| Request correlation | **READY** | `requestId` propagation added in Production Hardening, verified working in this test's logs |
| Runbooks | **MISSING** | None found in `docs/` |
| Cron monitoring | **PARTIAL** | Crons exist and are documented (`docs/PRODUCTION-HARDENING.md`); no dead-man's-switch/missed-run alerting |
| Job backlog monitoring | **MISSING** | No dashboard/alert on `integration_deliveries`/`lead_follow_ups` queue depth |
| Usage/cost monitoring | **READY** | `organization_usage_limits` + default caps (Production Hardening) + dashboard usage page |

## 16. Exact fixes required before enterprise launch, in priority order

1. ~~Add the `phone_match_key`/unique-constraint-based dedup~~ — **done,
   commit `8a1db34`.**
2. Validate real horizontal scaling behavior on actual Vercel infrastructure
   (§13a) — this harness cannot answer it; needs a staging deploy + external
   load generator.
3. Decide and implement a lead-capture fallback for a Supabase outage
   (§13b) — even a local in-memory/queue buffer, or at minimum a visible
   degraded-mode signal.
4. Stand up a staging environment — blocks proper validation of #2 and
   ongoing regression testing.
5. Add a health/status endpoint + cron dead-man's-switch + queue-depth
   alerting — cheap, currently all missing.
6. Build a browser-based (Playwright) load-testing lane for dashboard and AI
   Sales Manager — this k6 harness structurally cannot reach those two paths
   correctly.
7. Document backup/restore and incident-response runbooks — process gaps,
   not code.

Everything else tested (booking concurrency, Integration Hub, follow-up
worker, requestId idempotency, chat/dashboard error handling, all
failure-injection paths that were exercised) **passed cleanly** and needs no
immediate action.
