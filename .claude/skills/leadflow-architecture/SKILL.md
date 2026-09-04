---
name: leadflow-architecture
description: This skill should be used when adding a feature, module, industry template, or refactor to LeadFlow AI — anything that changes how the engine, configuration, or service layer is structured — to keep the multi-tenant, config-driven architecture generic and avoid parallel or industry-specific code paths.
---

# LeadFlow Architecture

LeadFlow is a multi-tenant SaaS whose engine (qualification, scoring, agent
actions, configuration) is generic and config-driven. An industry, provider,
or organization is data flowing through the engine, never a branch in it.

## Rules

- Treat the repository as the source of truth. Before writing code, inspect
  the relevant existing directory (e.g. `src/lib/config/`, `src/lib/agent/`,
  `src/lib/calendar/`, `src/lib/whatsapp/`) to find the abstraction,
  interface, or service that already covers this concern.
- Never branch on an industry, organization, or provider name inside engine
  or service code (no `if (industry === "...")`, no per-tenant special
  cases). New industries/settings are template or config data, not code.
- Reuse existing abstractions, resolvers, and services rather than building
  a second path that does something similar. If two implementations would
  end up doing the same job, consolidate on the existing one.
- Prefer the smallest change that fits the current architecture over a
  broader refactor. Restructure existing code only when the task explicitly
  calls for it or the existing shape cannot support the request at all.
- Keep the same layering already used in the codebase (e.g. pure/config
  logic separate from I/O, a single service entry point shared by every
  caller of a feature) instead of introducing a new pattern for one
  feature.
