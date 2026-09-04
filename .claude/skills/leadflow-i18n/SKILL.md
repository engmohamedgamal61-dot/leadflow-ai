---
name: leadflow-i18n
description: This skill should be used whenever adding or changing any user-facing text or UI in LeadFlow — pages, components, buttons, labels, empty/error/validation states — to ensure full Arabic and English coverage, correct RTL/LTR rendering, and use of the existing translation system instead of hardcoded strings.
---

# LeadFlow Internationalization

LeadFlow's UI is bilingual (Arabic + English) by design, not as an
afterthought. Every change that adds or edits user-facing text must ship
both languages together.

## Rules

- Never hardcode a user-facing string in a component. Add the string to
  the existing translation dictionaries (both the English and Arabic
  files) and reference it through the project's existing i18n
  hook/helper, the same way surrounding code already does.
- A change is incomplete if it adds an English string without its Arabic
  counterpart in the same dictionaries, or vice versa — add both before
  considering the work done.
- Arabic renders right-to-left and English left-to-right; rely on the
  document-level direction the app already sets rather than hardcoding
  direction. Use logical CSS properties (start/end, not left/right) so
  layout mirrors automatically instead of breaking in one direction.
- Locale-aware formatting (dates, numbers) goes through the existing
  formatting helpers, not ad hoc `Date`/`Number` formatting.
- Canonical values — database enums, status/role codes, API/provider
  identifiers — are never translated themselves; only their displayed
  label in the UI is localized, keyed off the untranslated value.
