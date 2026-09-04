import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeEventKey,
  resolveTimelineEntry,
  localizeFieldView,
  buildLeadFieldViews,
} from "./lead-view.ts";
import { en } from "../../i18n/dictionaries/en.ts";
import { ar } from "../../i18n/dictionaries/ar.ts";
import {
  createOptionalTranslator,
  createTranslator,
} from "../../i18n/translate.ts";
import { realEstateTemplate } from "../config/templates/real-estate.ts";
import type { LeadData } from "../../types/chat.ts";

const enCtx = {
  t: createTranslator(en),
  tOptional: createOptionalTranslator(en),
  locale: "en" as const,
};
const arCtx = {
  t: createTranslator(ar),
  tOptional: createOptionalTranslator(ar),
  locale: "ar" as const,
};

test("describeEventKey produces locale-free descriptors with stable keys", () => {
  assert.equal(
    describeEventKey({ event_type: "follow_up_executed", metadata: { channel: "whatsapp" }, created_at: "t" }).titleKey,
    "events.followUpExecuted",
  );
  assert.equal(
    describeEventKey({ event_type: "status_changed", metadata: { from: "new", to: "qualified" }, created_at: "t" }).detail?.kind,
    "statusTransition",
  );
  // unknown types fall back to a humanized literal, never a raw key
  const unknown = describeEventKey({ event_type: "some_future_event", metadata: null, created_at: "t" });
  assert.equal(unknown.titleKey, null);
  assert.equal(unknown.titleText, "Some future event");
});

test("resolveTimelineEntry localizes titles + transitions in both locales", () => {
  const statusEvent = describeEventKey({
    event_type: "status_changed",
    metadata: { from: "new", to: "qualified" },
    created_at: "2026-09-04T00:00:00Z",
  });
  assert.equal(resolveTimelineEntry(statusEvent, enCtx).title, "Status changed");
  assert.equal(resolveTimelineEntry(statusEvent, enCtx).detail, "New → Qualified");
  assert.equal(resolveTimelineEntry(statusEvent, arCtx).title, "تغيّرت الحالة");
  assert.equal(resolveTimelineEntry(statusEvent, arCtx).detail, "جديد ← مؤهّل");

  const created = describeEventKey({
    event_type: "lead_created",
    metadata: { score: 55, temperature: "warm" },
    created_at: "t",
  });
  assert.match(resolveTimelineEntry(created, enCtx).detail ?? "", /Initial score 55 · Warm/);
  assert.match(resolveTimelineEntry(created, arCtx).detail ?? "", /55/);
  assert.match(resolveTimelineEntry(created, arCtx).detail ?? "", /دافئ/);
});

test("resolveTimelineEntry passes raw model/user text straight through", () => {
  const handoff = describeEventKey({
    event_type: "human_handoff_requested",
    metadata: { reason: "customer asked to speak to a person" },
    created_at: "t",
  });
  assert.equal(
    resolveTimelineEntry(handoff, arCtx).detail,
    "customer asked to speak to a person",
  );
});

test("localizeFieldView translates label, boolean, empty and select-option values", () => {
  const lead: LeadData = {
    name: "Sara",
    phone: null,
    email: null,
    intent: "buy",
    customData: { budget: 900000, financing: true },
  };
  const views = buildLeadFieldViews(lead, realEstateTemplate.leadFields);

  const intent = views.find((v) => v.key === "intent")!;
  assert.equal(localizeFieldView(intent, enCtx).display, "Buy");
  assert.equal(localizeFieldView(intent, arCtx).display, "شراء");
  assert.equal(localizeFieldView(intent, arCtx).label, "الغرض");

  const financing = views.find((v) => v.key === "financing")!;
  assert.equal(localizeFieldView(financing, enCtx).display, "Yes");
  assert.equal(localizeFieldView(financing, arCtx).display, "نعم");

  const budget = views.find((v) => v.key === "budget")!;
  assert.equal(localizeFieldView(budget, enCtx).display, "900,000");

  const phone = views.find((v) => v.key === "phone")!;
  assert.equal(localizeFieldView(phone, arCtx).display, "—");
});
