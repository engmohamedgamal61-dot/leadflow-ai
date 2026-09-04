---
name: leadflow-ui
description: This skill should be used when building or modifying LeadFlow dashboard screens, navigation, or visual components — to preserve the current premium SaaS visual language, the sidebar-based dashboard layout, RTL/LTR mirroring, and role-based visibility, instead of introducing a new design or placeholder pages.
---

# LeadFlow UI

The dashboard has an established visual language and layout. Changes should
fit into it, not replace it.

## Rules

- Preserve the current visual language: existing colors, spacing, typography,
  and component styles. A requested change is a targeted edit, not a
  license to redesign surrounding UI that wasn't asked about.
- The dashboard uses a persistent vertical sidebar on desktop that collapses
  to a drawer on mobile/tablet. Keep this pattern for any new dashboard
  screen or navigation change rather than reintroducing a different nav
  style.
- The sidebar sits on the side that matches the current text direction
  (right for Arabic/RTL, left for English/LTR) automatically, via logical
  CSS properties tied to the document direction — never hardcode a side.
- Show navigation items and controls according to the role-permission
  checks already implemented in the codebase (e.g. hide settings a role
  can't manage). Reuse those existing checks; don't invent new permission
  logic just to decide UI visibility.
- Don't create placeholder routes, pages, or nav entries for features that
  don't exist yet. If a requested nav item has no backing page, surface
  that gap instead of stubbing it out.
