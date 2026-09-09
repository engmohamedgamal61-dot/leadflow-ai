# Pilot setup

What to configure before putting LeadFlow in front of the first real customer.
Assumes the app is deployed and a Supabase project exists.

## 1. Core environment

Set these on the deployment (see `.env.example` for the annotated list):

- `ANTHROPIC_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `APP_BASE_URL` — the exact public origin, e.g. `https://app.yourcompany.com`.
  Auth emails and OAuth redirects are built from this; a wrong value breaks
  password reset and calendar connect.
- `FOLLOW_UP_CRON_SECRET` — `openssl rand -hex 32`. Point a scheduler (Vercel
  Cron, Supabase Cron, GitHub Actions) at `POST /api/internal/follow-ups/run`
  with header `Authorization: Bearer <secret>` every 5–15 minutes.

Apply migrations: `npx supabase db push` (or run `supabase/migrations/*.sql` in
order via the SQL editor).

## 2. Transactional email (SMTP) — required

LeadFlow sends **no** email itself. Password-reset and email-confirmation
messages are sent by **Supabase Auth**. The Supabase built-in email sender is
rate-limited to a few messages per hour and is explicitly not for production —
configure a real SMTP provider (SES, Postmark, Resend, SendGrid, Mailgun…):

1. Supabase dashboard → **Authentication → Emails → SMTP Settings**: host, port,
   username, password, sender email, sender name.
2. Supabase dashboard → **Authentication → URL Configuration**:
   - **Site URL** = your `APP_BASE_URL`
   - **Redirect URLs** — add `https://<APP_BASE_URL>/auth/confirm` and
     `https://<APP_BASE_URL>/auth/confirm?next=/reset-password`
3. Send yourself a password reset from `/forgot-password` and confirm the link
   resolves and logs you in.

For local dev, the same settings live in `supabase/config.toml` under
`[auth.email.smtp]`; mail is captured by Mailpit at `http://127.0.0.1:54324`.

## 3. Restrict signup

Public `/signup` is open by default. To gate it for the pilot:

- Set `SIGNUP_INVITE_CODE` to a shared secret. Visitors must enter it to create
  an account. Team invitations (below) carry a signed link that bypasses the
  gate, so invited teammates are unaffected.

## 4. Rate limiting

`/api/chat` (public qualification chat + embedded widget) is rate-limited by the
DB-backed `hit_rate_limit` function. Defaults: 20 requests / IP / 60s and 600 /
org / hour. Override with `CHAT_RATE_LIMIT_PER_IP`, `CHAT_RATE_WINDOW_SECONDS`,
`CHAT_RATE_LIMIT_PER_ORG_HOURLY`. The limiter **fails open** — if its RPC errors,
requests are allowed and the failure is reported (see §5).

## 5. Operational alerting

Set `OPS_ALERT_WEBHOOK_URL` to an `https://` incoming webhook (Slack or Discord
shape — the payload is `{ "text": "..." }`). Unhandled errors in the chat
stream, the WhatsApp webhook, and the follow-up scheduler are posted there with
secrets redacted. Without it, the same reports still go to stderr as structured
`[ops] {...}` lines — make sure your platform captures those.

## 6. Onboard the customer

1. Send the customer owner a signup link (with the invite code if gated). They
   create an account and an organization, picking their industry template.
2. They connect integrations under **Settings**:
   - **AI** — persona, qualification tuning.
   - **Integrations** — WhatsApp (Meta Cloud API) and/or Google Calendar. Both
     need their own credentials; see `.env.example`. If those aren't available,
     the pilot can still run on the website widget alone.
3. **Settings → Team** — invite teammates by email and role (admin / manager /
   sales / viewer; `owner` cannot be invited). Each invite produces a link to
   send the person; accepting it adds them to *this* org only.

## 7. Website widget (leads from the customer's own site)

1. **Settings → Widget** — enable the widget. Copy the `<iframe>` snippet; it
   embeds `/embed/<widget_key>`.
2. **Add every site under "Allowed sites"** (one origin per line, e.g.
   `https://www.acme.com`). The widget only runs on these origins — the
   `/embed` page refuses to render when framed by any other site, and every
   `/api/chat` turn is re-checked against the same list. An empty list blocks
   the widget **everywhere**, so this step is required, not optional.
   - Localhost is allowed automatically outside production (or with
     `WIDGET_ALLOW_DEV_ORIGINS=1`); in production add `http://localhost:PORT`
     explicitly if the customer needs to test locally.
3. The customer pastes the snippet into their site. Chats there resolve to the
   customer's organization server-side via the widget key — leads never land in
   the demo org (an invalid, disabled, suspended, or origin-blocked key never
   falls back to it), and tenant data stays RLS-isolated.
4. Rotate the key from the same screen if it's ever mishandled.

## 8. Pre-pilot checklist

- [ ] Migrations applied; `npm run build` clean on the deploy.
- [ ] Password reset email received and working end to end.
- [ ] `SIGNUP_INVITE_CODE` set (if signup should be closed).
- [ ] Cron hitting the follow-up run route (check the response counts).
- [ ] `OPS_ALERT_WEBHOOK_URL` set, or stderr logs captured.
- [ ] Customer org created, AI configured, at least one channel connected.
- [ ] Widget enabled and embedded on a test page; a test chat produces a lead
      in the customer org.
- [ ] Team invite sent, accepted, correct role.

## Production security

See **`docs/PRODUCTION-SECURITY.md`** for the full pre-production checklist:
secret rotation, Supabase Auth settings (Secure password change, email
confirmation, redirect URLs), the trusted client-IP / proxy header for your
platform, the outbound network-egress allowlist, and the demo-org guard. The
server refuses to boot in production if a required secret is a dev placeholder.

## Known limits for the pilot

- `style-src` still allows `'unsafe-inline'` (React attribute styles). Scripts
  are nonce-only in production — no `'unsafe-inline'` / `'unsafe-eval'`.
- The widget origin check relies on browser-set headers (`Referer`,
  `Sec-Fetch-Site`) plus the widget script's self-reported parent origin. This
  stops a copied key from working on an unauthorized site from a real browser;
  it is not a defense against a hand-crafted non-browser request (true of any
  origin check). Tenant isolation still rests on RLS + the server-side key
  resolution, not on the origin check.
- Owner transfer is not exposed — provision the correct owner at signup.
