import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChatContext } from "./chat-context.ts";

const membership = {
  organizationId: "org_member",
  industryTemplateId: "clinic",
};
const demo = { organizationId: "org_demo", industryTemplateId: "real-estate" };
const widget = { organizationId: "org_widget", industryTemplateId: "real-estate" };

const base = { widgetOrg: null, demoOrg: null };

test("authenticated request resolves the organization from membership", () => {
  const ctx = buildChatContext({ ...base, authenticated: true, membership });
  assert.deepEqual(ctx.organization, {
    organizationId: "org_member",
    industryTemplateId: "clinic",
    source: "member",
  });
});

test("authenticated request NEVER allows the client industry hint", () => {
  const ctx = buildChatContext({ authenticated: true, membership, widgetOrg: widget, demoOrg: demo });
  assert.equal(ctx.industryHintAllowed, false);
  assert.equal(ctx.organization?.organizationId, "org_member");
  assert.equal(ctx.organization?.industryTemplateId, "clinic");
});

test("authenticated user mid-onboarding (no membership) → no org, no hint", () => {
  const ctx = buildChatContext({ authenticated: true, membership: null, widgetOrg: widget, demoOrg: demo });
  assert.equal(ctx.organization, null);
  assert.equal(ctx.industryHintAllowed, false);
});

test("anonymous request with a widget key → the customer org, hint inert", () => {
  const ctx = buildChatContext({ authenticated: false, membership: null, widgetOrg: widget, demoOrg: demo });
  assert.deepEqual(ctx.organization, {
    organizationId: "org_widget",
    industryTemplateId: "real-estate",
    source: "widget",
  });
  assert.equal(ctx.industryHintAllowed, false, "the widget org's template wins, not the client hint");
});

test("anonymous request uses the demo org and MAY use the industry hint", () => {
  const ctx = buildChatContext({ authenticated: false, membership: null, widgetOrg: null, demoOrg: demo });
  assert.deepEqual(ctx.organization, {
    organizationId: "org_demo",
    industryTemplateId: "real-estate",
    source: "dev-demo",
  });
  assert.equal(ctx.industryHintAllowed, true);
});

test("anonymous request with no demo org → config-only, hint still allowed", () => {
  const ctx = buildChatContext({ authenticated: false, membership: null, widgetOrg: null, demoOrg: null });
  assert.equal(ctx.organization, null);
  assert.equal(ctx.industryHintAllowed, true);
});
