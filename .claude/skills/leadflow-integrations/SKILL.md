---
name: leadflow-integrations
description: This skill should be used when adding, modifying, or reviewing an external provider integration in LeadFlow (WhatsApp, Google Calendar, or any future messaging/calendar/CRM/provider) — covering adapters, OAuth, webhooks, and credentials — to keep providers behind a swappable interface and out of core business logic.
---

# LeadFlow Integrations

Every external provider is isolated behind a generic adapter/interface so it
can be swapped or added to without changing the code that uses it.

## Rules

- Core business logic (the AI engine, lead/appointment/follow-up services,
  dashboard actions) must depend only on the provider-neutral interface —
  never import a provider SDK, call a provider's HTTP API directly, or
  branch on a provider name outside that provider's own adapter module.
- Inspect the existing adapter pattern in the repo (e.g. how the WhatsApp
  and Calendar integrations are structured) before adding a new provider,
  and follow the same shape: one interface, one adapter module per
  provider, one registry that resolves which adapter to use.
- Adding a new provider means implementing the existing interface and
  registering it — it must not require changing the interface itself or
  its callers.
- OAuth flows, webhook handlers, and stored credentials stay server-side.
  Verify webhook signatures and OAuth state/callbacks before trusting their
  payload, and never let a provider-specific payload shape, token, or
  identifier leak into shared/core code or the client.
- Keep provider-specific quirks (rate limits, retry rules, payload
  quirks) inside that provider's own adapter/config module, not in the
  shared service layer.
