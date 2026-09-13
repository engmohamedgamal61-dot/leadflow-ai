# Backup & restore

**No restore drill has been performed.** Everything below is documentation
of what should be backed up and how a restore should be verified — it has
not been exercised end-to-end against a real Supabase project. Treat the
"restore verification checklist" as untested until someone actually runs it.
Don't claim otherwise in a status report.

## What must be backed up

- **The Supabase Postgres database, in full** — `public` (all application
  tables), `private` (rate limits, and every `SECURITY DEFINER` helper
  function's backing data), and `auth` (Supabase-managed user accounts,
  sessions, identities). All three live in the **same** Postgres instance,
  so a standard Supabase/`pg_dump`-level backup already covers all three —
  there is nothing split across separate systems to coordinate.
- **No Supabase Storage buckets are used by this app** — nothing to back up
  there (confirmed by inspection: no `.storage.` call anywhere in `src/`).
- **The server-only encryption keys, separately, outside the database**:
  `CALENDAR_TOKEN_ENCRYPTION_KEY`, `INTEGRATION_TOKEN_ENCRYPTION_KEY`,
  `WHATSAPP_TOKEN_ENCRYPTION_KEY`. This is the one easy-to-miss part: OAuth/
  webhook tokens are stored **encrypted at rest** in the database, but the
  keys that decrypt them live only in your deployment's environment
  variables, never in the database itself. **A database restore without the
  matching encryption keys leaves every stored Calendar/WhatsApp/Integration
  Hub credential permanently undecryptable** — those integrations would need
  to be reconnected from scratch, not "restored." Keep these keys backed up
  (a password manager / secrets vault your deploy platform doesn't itself
  hold) with the same care as the database, and **never rotate one without a
  plan** for what happens to already-encrypted rows (see
  `docs/PRODUCTION-SECURITY.md` §1 — rotation isn't covered by this repo
  today; a rotated key orphans existing encrypted tokens the same way a lost
  key would).
- **The `vercel.json` / deployment config and env var list** — not data, but
  needed to stand the app back up identically; already in git except the
  actual secret values (§ above).

## Supabase/Postgres backup expectations

Supabase's backup/PITR (point-in-time recovery) availability and retention
window depend on the project's plan tier — **check Supabase's current
pricing/docs at the time you set this up**, since this changes and this repo
has no automated way to verify it. As of writing:
- Free-tier projects have **no automatic backups** — this is the tier
  explicitly called out as unsuitable for anything beyond local dev/staging
  smoke-testing in the staging-environment plan.
- Paid tiers add automatic daily backups; higher tiers add point-in-time
  recovery with a retention window that scales with the plan.

**Action for production**: confirm the actual plan tier has backups/PITR
enabled in the Supabase dashboard (Settings → Database → Backups) — don't
assume it from the plan name alone, and don't assume this document's
description of Supabase's tiers is still accurate by the time you read it.

## Restore verification checklist

After any restore — a real incident or a deliberate drill — verify, in this
order, before declaring it done:

1. **Schema version**: check `supabase/migrations/` against what's actually
   present in the restored database (every migration's effects — new
   tables/columns/functions — should be there). A backup taken before a
   later migration shipped will be missing it — see "Migration
   considerations" below.
2. **RLS is enabled and policies exist** on every tenant table (`leads`,
   `conversations`, `messages`, `lead_follow_ups`, `integration_*`, etc.) —
   a restore process that used `--no-owner`/`--no-acl`-style flags
   incorrectly, or restored only data without the schema's policy
   definitions, can silently leave tables RLS-disabled. Never bring a
   restored database into production traffic without checking this
   specifically — it's the one mistake that turns a backup incident into a
   tenant-isolation incident.
3. **`service_role` grants** on the `SECURITY DEFINER` functions
   (`claim_due_follow_ups`, `hit_rate_limit`, `cleanup_expired_rate_limits`,
   `claim_integration_deliveries`, `follow_up_backlog_summary`,
   `integration_hub_backlog_summary`, `rate_limit_backlog_summary`, …) are
   intact — `\df+ public.*` in `psql` or the Supabase SQL editor, confirm
   each still shows `service_role` in its ACL and nothing broader.
4. **Auth works**: an existing user can log in; a new signup completes
   end-to-end (if signup is open) or a team invite link still resolves.
5. **The app boots**: `assertProductionReadiness()` (`src/instrumentation.ts`)
   doesn't refuse to start — it would if a required secret/env var is
   missing, which is itself a useful post-restore check that everything
   needed is actually configured, not just the database.
6. **`GET /api/health/ready` → `200`.**
7. **One real end-to-end smoke test**: a test chat through the widget
   produces a lead in a **test** organization (never poke a real customer
   org to verify a restore) and `GET /api/internal/ops/summary` returns a
   sane (non-error) summary.
8. **Encrypted-token integrations**, if any were connected before the
   incident: confirm the encryption keys used at backup time are the ones
   currently deployed (§ above) — if not, expect Calendar/WhatsApp/
   Integration Hub credentials to need reconnection, and say so explicitly
   rather than assuming a restore silently "worked" for those.

## Migration considerations

- **Migrations are forward-only in this repo** — no down-migrations exist
  (`supabase/migrations/*.sql` only ever add). A restore to a backup taken
  **before** a later migration shipped will be missing that migration's
  schema changes; re-apply every migration created after the backup's
  timestamp (`npx supabase db push`, or run the specific `.sql` files in
  order via the SQL editor) before the current app code — which expects the
  latest schema — is pointed at the restored database.
- **Coordinate the app version with the backup's schema version.** A backup
  restored to run against app code that's *newer* than what was live at
  backup time can break in exactly the way described above (missing
  columns/functions); running *older* app code against a *newer* restored
  schema is usually safe (this repo's migrations are additive — new
  nullable/defaulted columns, new tables, new functions — see the existing
  migration comments' own "no existing table is restructured" convention)
  but isn't guaranteed for every future migration, so verify rather than
  assume.
- **Never hand-edit an already-applied migration file** to "fix" a restore
  mismatch — write a new forward-fix migration instead (the same rule the
  rollback runbook (`docs/INCIDENT-RUNBOOK.md` §7) uses for a bad deploy).
