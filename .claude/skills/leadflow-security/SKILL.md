---
name: leadflow-security
description: This skill should be used when writing or reviewing LeadFlow code that touches organization/tenant data, authentication, Row Level Security policies, secrets, API keys, encryption, or accepts input from an AI model, webhook, or external provider — to keep tenant isolation, server-only secrets, input validation, and idempotency/concurrency protections intact.
---

# LeadFlow Security

LeadFlow is multi-tenant; every row, request, and write must stay scoped to
the correct organization, and the database's Row Level Security is the real
enforcement boundary — application checks are defense-in-depth, not a
substitute for it.

## Rules

- Never accept an organization ID (or any tenant-scoping value) from client
  input. Derive it server-side from the authenticated user's membership,
  the same way the existing session/membership resolution in the repo does.
- Preserve RLS: any new table or write path needs policies consistent with
  the existing ones (read for members, write for the roles that already
  have that privilege). Don't rely on application code alone to enforce
  tenant isolation.
- Keep secrets (API keys, OAuth tokens, encryption keys, signing secrets)
  server-only: never sent to the client, never logged in plaintext, read
  only from server-side env/config, and encrypted at rest when stored,
  matching the pattern already used for existing credentials.
- Treat anything from an AI model's output, a webhook payload, or a
  provider callback as untrusted. Validate and re-check it server-side
  (schema/shape, signatures, ownership) before it drives a write or an
  external call — never execute an action just because a model proposed it.
- When adding a write path, preserve existing idempotency (request IDs,
  unique constraints) and concurrency protections (DB-level locks or
  exclusion constraints) already used for similar operations, and add
  equivalent protection for genuinely new write paths instead of relying on
  a check-then-write race.
