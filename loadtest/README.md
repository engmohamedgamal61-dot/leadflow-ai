# LeadFlow AI — Enterprise Readiness load-test harness

Isolated from application code — nothing under `src/` is changed to build or
run this. It drives a real local Supabase and a real `next start` production
build, with Anthropic and Google Calendar traffic redirected to deterministic
mocks so no load test ever reaches a real provider.

**Read this before running anything:** every number this harness produces is
a *local, single-machine* measurement (see "What this harness can and can't
tell you" below). It is a tool for finding bottlenecks and proving
correctness under concurrency — not a substitute for testing on real staging
infrastructure before trusting a capacity number.

See `FINDINGS.md` in this directory for the results and conclusions of the
Enterprise Readiness phase that built this harness.

## Layout

```
loadtest/
  README.md              this file
  FINDINGS.md             results + findings from the completed test phase
  mocks/
    anthropic-mock-server.mjs      real Anthropic Messages API shape (SSE + JSON)
    webhook-receiver-mock.mjs      Integration Hub delivery target
  seed/
    seed.mjs                        creates N real test orgs
    setup-integration-hub.mjs       one Integration Hub endpoint per org
  scripts/
    lib/config.js, lib/auth.js      shared k6 helpers
    a-widget-boot.js .. g-follow-up-worker.js   one script per scenario (A–G)
    smoke-auth.js                   quick sanity check for the auth helper
  results/                          gitignored — see "Generated output" below
```

- `mocks/anthropic-mock-server.mjs` — real Anthropic Messages API shape
  (streaming SSE + non-streaming JSON), paced to approximate real latency.
  Supports `PHONE:<digits>` / `BOOK_SLOT:<iso>` triggers in the chat message
  text for controllable extraction, and a `/_control/scenario` endpoint for
  failure injection (`ok` / `timeout` / `rate_limit_429` / `server_error_500`).
- `mocks/webhook-receiver-mock.mjs` — Integration Hub delivery target, same
  `/_control/scenario` shape (`ok` / `fail_500` / `timeout`).
- `seed/seed.mjs [orgCount]` — creates N real orgs (owner + widget + a mock
  Google Calendar connection + a few pre-existing leads), writes
  `results/seed-data.json`.
- `seed/setup-integration-hub.mjs` — one Integration Hub endpoint per seeded
  org, pointed at the webhook mock.
- `scripts/lib/config.js` — shared constants + the seed-data loader. Requires
  `SUPABASE_ANON_KEY` at startup (see below) — it does not fall back to any
  hardcoded key, so a missing env var fails immediately with a clear error
  rather than silently using the wrong project.
- `scripts/lib/auth.js` — builds a real `@supabase/ssr` session cookie from a
  GoTrue password-grant login. No application code needed to support it.
- `scripts/{a..g}-*.js` — one k6 script per scenario (A–G, see "Scenarios").

## Prerequisites

| Tool | Why | Install |
|---|---|---|
| Node.js (already required by the app) | runs the seed/mock scripts | already in your dev setup |
| Docker Desktop (or equivalent) | backs local Supabase | already required for `supabase start` |
| Supabase CLI | local Postgres + Auth + REST | `npx supabase` (already a repo devDependency path — no separate install needed beyond Node) |
| **k6** | the actual load generator | **not** an npm package — install separately |

Install k6 on macOS:

```bash
brew install k6
```

(Other platforms: see https://grafana.com/docs/k6/latest/set-up/install-k6/.)

Run `npm install` at the repo root first, same as for the app itself — the
seed scripts import directly from `src/lib/...` (calendar crypto, integration
secrets) to write real, correctly-shaped rows, so they need the repo's own
`node_modules` present.

## 1. Start local Supabase

From the repo root:

```bash
npx supabase start      # first time / already running is fine
# or, for a clean slate with every migration re-applied:
npx supabase db reset
```

Note the `API_URL`, `ANON_KEY`, and `SERVICE_ROLE_KEY` it prints (or run
`npx supabase status` any time to see them again) — you'll need them below.
These are local-only credentials tied to your own Docker containers; they
are not secrets and are not the same on any two machines.

## 2. Environment variables

Nothing in this harness hardcodes a credential. Export these before seeding
(values come from `npx supabase status`, or match your existing `.env.local`
if you already have one for the app):

```bash
export LEADFLOW_DB_TEST_URL="http://127.0.0.1:54321"           # API_URL
export LEADFLOW_DB_TEST_ANON_KEY="<ANON_KEY from supabase status>"
export LEADFLOW_DB_TEST_SERVICE_KEY="<SERVICE_ROLE_KEY from supabase status>"
export CALENDAR_TOKEN_ENCRYPTION_KEY="$(openssl rand -hex 32)"
export INTEGRATION_TOKEN_ENCRYPTION_KEY="$(openssl rand -hex 32)"
```

The two encryption keys just need to be *some* valid 64-hex-char value —
seed.mjs uses them to write encrypted placeholder tokens into a fresh local
database, so any freshly generated key works; it does not need to match a
value you've used before, unless you're pointing at a local DB that already
has other encrypted rows in it.

## 3. Seed test data

```bash
node loadtest/seed/seed.mjs 30              # 30 orgs is what FINDINGS.md used
node loadtest/seed/setup-integration-hub.mjs
```

This creates real organizations, owner auth users, enabled widgets, a mock
Google Calendar connection per org, and a handful of pre-existing leads —
then one Integration Hub endpoint per org pointed at the webhook mock.
Writes `loadtest/results/seed-data.json` (org ids, owner credentials for
*this run's throwaway local test users*, widget keys) and
`loadtest/results/integration-endpoints.json` — both gitignored (see below);
every k6 script reads `seed-data.json` at startup.

## 4. Start the mocks

```bash
node loadtest/mocks/anthropic-mock-server.mjs &     # :9101 (override: MOCK_ANTHROPIC_PORT)
node loadtest/mocks/webhook-receiver-mock.mjs &      # :9102 (override: MOCK_WEBHOOK_PORT)
```

**Anthropic mock**: implements the real Messages API request/response shape
(streaming SSE and non-streaming JSON), paced with a small artificial delay
to approximate real latency rather than responding instantly. No call ever
reaches Anthropic. Two special triggers in the chat message text control its
behavior for specific scenarios: `PHONE:<digits>` makes the mock "extract"
that phone number (Scenario C, dedup), and `BOOK_SLOT:<iso-timestamp>` makes
it propose a `book_appointment` action for that slot (Scenario E, booking) —
the timestamp must be within 60 days of "now" or the app's own validation
silently drops it (not a mock bug — see `APPOINTMENT_MAX_DAYS`).

**Google Calendar mock**: no separate mock server needed — the app already
ships a built-in mock transport for local dev. Setting
`CALENDAR_MOCK_TRANSPORT=1` (below) makes every Google Calendar API call
return a canned success without any network call, which is also why
`seed.mjs` can write a "connected" calendar connection with placeholder
tokens instead of running a real OAuth flow.

## 5. Start the app, pointed at the mocks

The app needs to run in **production mode** (`next start`, not `next dev`) —
`next dev`'s per-request compilation overhead makes every latency number
meaningless. Next.js loads `.env.production.local` on top of `.env.local`
when `NODE_ENV=production` (which `next start` sets), so create it at the
repo root with:

```bash
# .env.production.local — gitignored, load-test only, delete when done.
ANTHROPIC_API_KEY=sk-mock-not-a-real-key-do-not-use
ANTHROPIC_BASE_URL=http://localhost:9101   # @anthropic-ai/sdk reads this natively — no app code changes needed
ANTHROPIC_MODEL=claude-sonnet-5

NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<same ANON_KEY as above>
SUPABASE_SERVICE_ROLE_KEY=<same SERVICE_ROLE_KEY as above>

APP_BASE_URL=http://localhost:3100

FOLLOW_UP_CRON_SECRET=<any string>
INTEGRATION_HUB_CRON_SECRET=<any string — pass the same value as -e to g/f scripts>
RATE_LIMIT_CLEANUP_CRON_SECRET=<any string>

WHATSAPP_TOKEN_ENCRYPTION_KEY=<openssl rand -hex 32>
WHATSAPP_MOCK_TRANSPORT=1

CALENDAR_TOKEN_ENCRYPTION_KEY=<same value used for seeding>
CALENDAR_MOCK_TRANSPORT=1

INTEGRATION_TOKEN_ENCRYPTION_KEY=<same value used for seeding>
# The Integration Hub's SSRF-safe fetch otherwise refuses a local webhook
# target; only ever set this for a local load test, never in production.
INTEGRATION_ALLOW_INSECURE_URLS=1

# So k6 can simulate many distinct client IPs (all real traffic otherwise
# originates from 127.0.0.1) and exercise real per-IP rate limiting instead
# of either bypassing it or every VU colliding on one bucket.
RATE_LIMIT_CLIENT_IP_HEADER=x-loadtest-client-ip

LEADFLOW_ENABLE_DEMO_CHAT=0
```

Then:

```bash
npm run build
npm run start -- -p 3100    # a different port if 3000 is already your dev server
```

**Delete `.env.production.local` when you're done** — leaving it in place
would silently redirect a later `npm run build && npm run start` at the
mocks instead of real Anthropic/Supabase.

Two things this environment needs that are easy to miss:
- Integration Hub webhook URLs must use `127.0.0.1`, not `localhost` — the
  SSRF-safe fetch failed to resolve the literal hostname `localhost` in
  testing (`Invalid IP address: undefined`); a literal IP sidesteps it.
  `setup-integration-hub.mjs` already does this correctly.
- If port 3000 is already running something (e.g. your own `next dev`),
  pick a different port for the load-test instance — don't stop a session
  that isn't yours.

## 6. Run a scenario

```bash
cd loadtest/scripts
k6 run -e SUPABASE_ANON_KEY="<ANON_KEY>" -e VUS=100 -e DURATION=20s a-widget-boot.js
```

`SUPABASE_ANON_KEY` is required by every script (via `lib/config.js`) — it
throws a clear startup error if you forget it, rather than silently using any
default. `APP_URL` defaults to `http://localhost:3100`; override with
`-e APP_URL=...` if you started the app on a different port.

| Scenario | Script | What it exercises |
|---|---|---|
| A — Widget boot | `a-widget-boot.js` | `widget.js` + `/embed/<key>`, non-LLM path |
| B — Widget chat | `b-widget-chat.js` | full `/api/chat`, mocked streaming reply + extraction + persistence |
| C — Lead dedup | `c-lead-dedup.js` | repeated phone traffic, same org and cross-org (clinic-template orgs only — see the script's own comment for why) |
| D — Dashboard | `d-dashboard.js` | counts + leads list pagination (see harness limitation below) |
| E — Appointment booking | `e-appointment-booking.js` | distinct slots + concurrent same-slot contention |
| F — Integration Hub | `f-integration-hub.js` | enqueue → fan-out → claim → deliver, + failure injection |
| G — Follow-up worker | `g-follow-up-worker.js` | large due batch, concurrent workers, `SKIP LOCKED` |

Each script accepts `-e VUS=N -e DURATION=Ns` (or scenario-specific variants
like `VUS_SAME_ORG` / `VUS_DIFFERENT` — check the script's `options` block)
to control load level. Start low (10) before going higher — see
`FINDINGS.md` for what happened at each level on one specific machine.

`smoke-auth.js` is a 1-VU, 1-iteration sanity check for the auth helper
(`lib/auth.js`) — run it first if you've changed anything auth-related and
want a fast, cheap correctness check before a real load run.

### Running failure-injection scenarios

Both mocks expose the same control shape: `POST /_control/scenario` with
`{"scenario": "..."}`, and `GET /_control/state` to see the current one.

**Anthropic** (timeout / 429 / 500) — set it directly, run a script, reset it:

```bash
curl -X POST http://localhost:9101/_control/scenario \
  -H "Content-Type: application/json" -d '{"scenario":"rate_limit_429"}'
k6 run -e SUPABASE_ANON_KEY="<key>" b-widget-chat.js
curl -X POST http://localhost:9101/_control/scenario \
  -H "Content-Type: application/json" -d '{"scenario":"ok"}'
```

Valid scenarios: `ok`, `timeout`, `rate_limit_429`, `server_error_500`.

**Integration Hub webhook** (500 / timeout) — `f-integration-hub.js` can set
this itself via its `setup()` hook, so you don't need a separate `curl`:

```bash
k6 run -e SUPABASE_ANON_KEY="<key>" -e SUPABASE_SERVICE_KEY="<service-role-key>" \
  -e WEBHOOK_SCENARIO=fail_500 f-integration-hub.js
```

Valid scenarios: `ok`, `fail_500`, `timeout`. It's a global toggle on the
mock process, not a per-request one — it stays in effect until you set it
back to `ok` (via another run with `WEBHOOK_SCENARIO=ok`, or a direct
`curl` to `/_control/scenario`), so reset it before running a
non-failure-injection scenario against the same mock.

**Google Calendar** (429 / timeout): not available. The app's built-in
`CALENDAR_MOCK_TRANSPORT` has no failure-injection hooks, and adding one
would mean modifying application code, which this harness deliberately
avoids. Not exercised — see `FINDINGS.md`.

## Generated output

`loadtest/results/` is **intentionally gitignored** — `seed-data.json`,
`integration-endpoints.json`, and any k6 `--summary-export` files you write
there are regenerated fresh by `seed.mjs` / a k6 run every time, tied to
whatever org UUIDs and timestamps your own local database happens to have
right now. `seed-data.json` also contains a plaintext password for the
throwaway local Supabase auth users the seed script itself creates — fine
for disposable local accounts, not something that belongs in git history.
Never hand-edit or rely on a committed copy of anything in this directory.

## What this harness can and can't tell you

This runs against a single Docker-hosted local Postgres and one `next start`
Node process on one developer machine. That is **not** representative of
production: Vercel Fluid Compute auto-scales across many function instances
under load, and a properly provisioned hosted Supabase is configured very
differently from a fresh local `supabase start` (connection pool sizing in
particular — see `FINDINGS.md`'s database section). Findings about *where*
and *why* something is slow (a query, a lock, a single process saturating
one CPU core) transfer to production; absolute throughput and concurrency
numbers measured here do not directly predict production capacity.
**Treat every number in `FINDINGS.md` as "this is what one local machine
did," not as a production capacity claim.** Validating real horizontal
scaling requires running this same kind of load against a real staging
deployment on Vercel — that has not been done yet (see `FINDINGS.md`'s
remaining P1s).

## Known harness limitations

- The AI Sales Manager ("Ask LeadFlow") query is a Next.js Server Action, not
  a REST route — its wire protocol wasn't replicated; `d-dashboard.js` only
  load-tests the page shell, not the actual query round-trip.
- A hand-constructed dashboard session cookie showed intermittent
  redirect-to-login failures on reuse across requests within one k6 VU;
  re-authenticating every request eliminates it, but that then runs into
  local GoTrue's own sign-in throughput/rate-limiting at 50+ VUs. Neither is
  a confirmed LeadFlow application defect — a browser-based (Playwright)
  lane is the right tool to validate real dashboard session behavior under
  load without this ambiguity.
- Google Calendar failure injection (429 / timeout) has no configuration
  point without modifying `src/lib/calendar/google/client.ts`'s built-in mock
  transport — not exercised in this phase.
