---
name: leadflow-quality
description: This skill should be used for every LeadFlow code change — before editing, while implementing, and before reporting completion — to ensure the existing codebase is inspected first, changes stay minimal and reuse existing code, tests/lint/build are run, results are reported honestly, and commits/pushes only happen when explicitly requested.
---

# LeadFlow Quality Workflow

This is the baseline working process for any change to the LeadFlow AI
repository, on top of whatever the other LeadFlow skills add for a specific
area.

## Rules

- Before editing, inspect the existing architecture, patterns, and tests
  around the area being changed. Treat the repository, not memory or
  assumptions, as the source of truth for how things currently work.
- Make the smallest change that correctly and completely satisfies the
  request. Reuse existing functions, components, and helpers instead of
  duplicating logic, and avoid touching unrelated code.
- After changing code, run the relevant tests for the affected area, then
  the full test suite (`npm test`), linter, and build. Fix what the change
  broke before considering it done.
- Report outcomes honestly: state plainly what was changed, what was
  verified and how, and what wasn't tested or is a known limitation. Never
  claim something works, or that tests/build passed, without having run
  them in this session.
- Only commit or push when the user explicitly asks for it in the current
  request. Making the change and leaving it uncommitted is the default.
