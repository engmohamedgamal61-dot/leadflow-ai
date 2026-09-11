# Production security configuration

Everything that has to be set **outside the codebase** before LeadFlow is
production-secure. The application enforces what it can; this covers the rest.
A companion to `PILOT-SETUP.md`.

On boot in production (`NODE_ENV=production` with a non-localhost `APP_BASE_URL`),
`src/instrumentation.ts` runs `assertProductionReadiness()`: it **refuses to
start** if a required secret is missing or still a development placeholder, and
logs `[production-readiness]` warnings for the items below that it cannot verify
from inside the app.

---

## 1. Secrets — rotate every one; never reuse a dev value

Generate fresh values. `.env.local` in this repo contains **development
placeholders only** — none of them may appear in production.

| Env var | How to generate |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic console. (The one in `.env.local` was pasted in chat historically — treat as burned.) |
| `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL` | the production Supabase project's own keys (Settings → API). The local demo keys are rejected at boot. |
| `FOLLOW_UP_CRON_SECRET`, `INTEGRATION_HUB_CRON_SECRET`, `RATE_LIMIT_CLEANUP_CRON_SECRET` | `openssl rand -hex 32` |
| `CALENDAR_TOKEN_ENCRYPTION_KEY`, `INTEGRATION_TOKEN_ENCRYPTION_KEY`, `WHATSAPP_TOKEN_ENCRYPTION_KEY` | `openssl rand -hex 32` (64 hex chars each — enforced). Required even before Calendar/Hub/WhatsApp are used: an org can enable them from the dashboard at any time and a missing key would tempt an unencrypted hotfix. |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | from the Meta app — only when WhatsApp is onboarded (missing → warning, placeholder → fatal). |
| `GOOGLE_CALENDAR_CLIENT_ID` / `_SECRET` | Google Cloud OAuth client — only when Calendar is onboarded. |
| `APP_BASE_URL` | the exact public `https://` origin. |

Set `LEADFLOW_PRODUCTION_CHECKS_ACK` once §2–§4 are done, comma-separated or
`all`:
`secure-password-change,email-confirmation,redirect-urls,trusted-proxy,network-egress,no-demo-orgs`

---

## 2. Supabase Auth settings (dashboard — cannot be set from env)

- **Authentication → Providers → Email → "Secure password change" = ON.**
  With it on, changing a password from a normal signed-in session requires a
  fresh reauthentication; the password-**recovery** flow (`/forgot-password` →
  emailed link → `/auth/confirm` → `/reset-password`) is exempt and keeps
  working. The app maps the reauthentication error to
  `auth.errors.reauthRequired` ("use the reset link from your email").
  Ack: `secure-password-change`.
- **Authentication → Email confirmations = ON**, with a real SMTP provider
  configured (Authentication → Emails → SMTP Settings). The built-in sender is
  not for production. Ack: `email-confirmation`.
- **Authentication → URL Configuration:**
  - Site URL = `APP_BASE_URL`
  - Redirect URLs include `<APP_BASE_URL>/auth/confirm` and
    `<APP_BASE_URL>/auth/confirm?next=/reset-password`
  Ack: `redirect-urls`.

## 3. Trusted proxy / client-IP headers (rate limiting)

`X-Forwarded-For` is attacker-controlled — a reverse proxy *appends* the real IP
rather than replacing it, so the app must know how many trailing entries your
infrastructure adds, or which platform header holds the true client IP.

Set **one** of:

| Platform | Setting |
|---|---|
| Cloudflare | `RATE_LIMIT_CLIENT_IP_HEADER=cf-connecting-ip` |
| Vercel | `RATE_LIMIT_CLIENT_IP_HEADER=x-real-ip` (Vercel sets it to the client IP) |
| nginx / k8s Ingress with `real_ip_header` | `RATE_LIMIT_CLIENT_IP_HEADER=x-real-ip` |
| Fly.io | `RATE_LIMIT_CLIENT_IP_HEADER=fly-client-ip` |
| Generic LB, no trusted single-IP header | `RATE_LIMIT_TRUSTED_PROXY_HOPS=<n>` — how many trailing `X-Forwarded-For` entries you control (usually `1`, the default) |

A wrong value only mis-buckets the **per-IP** limit; the per-org and per-widget
caps still bound abuse. Ack: `trusted-proxy`.

## 4. Network egress restriction (the final SSRF control)

The Integration Hub lets an owner/admin register an outbound webhook URL. The
app defends every layer it can — literal-IP filtering across all encodings,
DNS resolution + validation of every resolved address at send time, connection
pinning to those addresses, and no redirect following — but **a network-level
egress allowlist / firewall is the strongest and final control.** Restrict the
app's outbound traffic to:

- `api.anthropic.com`
- your Supabase project host
- `oauth2.googleapis.com`, `www.googleapis.com` (Calendar, if used)
- `graph.facebook.com` (WhatsApp, if used)
- the specific customer webhook endpoints you expect (or `0.0.0.0/0` minus
  RFC1918 / link-local / `169.254.169.254` / your VPC CIDRs if you can't
  enumerate them)

Ack: `network-egress`.

## 5. Demo organizations must not exist in production

The seeded `demo-real-estate` / `demo-clinic` orgs are for the local marketing
demo. `supabase/seed.sql` only runs on `supabase db reset` / local `start` (not
`db push`), and additionally no-ops on any database that already has members —
but confirm the production database has no `slug LIKE 'demo-%'` organizations.

The app is also guarded: `LEADFLOW_ENABLE_DEMO_CHAT` is OFF by default and
**forced off in production** — anonymous chat without a widget key runs
config-only with no persistence, so a real lead can never be written to a demo
tenant. (Overriding this needs both `LEADFLOW_ENABLE_DEMO_CHAT=1` and
`LEADFLOW_FORCE_DEMO_CHAT=1`; don't.)

Ack: `no-demo-orgs`.

---

## Content-Security-Policy

Set per request in `src/proxy.ts` with a fresh nonce. Production:

```
script-src 'self' 'nonce-<per-request>'      ← no unsafe-inline, no unsafe-eval
style-src  'self' 'unsafe-inline'            ← see below
default-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'
frame-ancestors 'none'   (all routes)
frame-ancestors 'self' https: http://localhost:*   (/embed/* only)
connect-src 'self' <supabase-url> wss://<supabase-host>
upgrade-insecure-requests
```

- No CDN, analytics, or third-party script is loaded, so `script-src` needs no
  host allowlist. If you add one later, extend the `buildCsp` `connect-src` /
  `script-src` in `src/lib/security/csp.ts`.
- **`style-src 'unsafe-inline'` is a deliberate residual.** React renders
  `style="…"` attributes throughout the dashboard and a nonce does not cover
  attribute styles; `'strict-dynamic'` was also dropped because it breaks
  Next's `<link>`-based route-chunk prefetch. Style injection cannot execute
  JavaScript — the XSS-relevant lever is `script-src`, which is strict. There
  are no `dangerouslySetInnerHTML` / `eval` sinks in the app.
- `/embed/*` is intentionally framable by any HTTPS site; the per-org origin
  allowlist (Settings → Widget) is enforced by the `/embed` page and by every
  `/api/chat` turn, not by CSP.

No deployment-specific CSP change is required unless you introduce an external
resource.

---

## Residual accepted risks

| Risk | Why it can't be closed in app code | Compensating control |
|---|---|---|
| `style-src 'unsafe-inline'` | React attribute styles + Next prefetch vs `strict-dynamic` | strict `script-src`; no XSS sinks |
| Per-IP rate-limit accuracy | the true client IP is only known to the edge | operator sets §3; per-org / per-widget caps are the real bound |
| DNS-rebinding TOCTOU (sub-millisecond) between our resolve and the pinned connect | DNS is external | connection is pinned to pre-validated addresses; §4 egress firewall |
| Widget origin check trusts browser headers | any origin check does | tenant isolation rests on RLS + server-side key resolution, not the origin check |
| A suspended org's members retain access until billing acts | product/billing decision | RLS still isolates their tenant; no cross-org exposure |
