import { test } from "node:test";
import assert from "node:assert/strict";
import { en } from "../../i18n/dictionaries/en.ts";
import { ar } from "../../i18n/dictionaries/ar.ts";
import type { Dictionary } from "../../i18n/dictionaries/index.ts";
import {
  genericChatPresentation,
  resolveChatPresentation,
} from "./presentation.ts";
import { getEffectiveConfig } from "../config/index.ts";

const EN = en as unknown as Dictionary;
const AR = ar as unknown as Dictionary;

/** Any word that would prove a real-estate template leaked into the shell. */
const REAL_ESTATE_TOKENS =
  /apartment|villa|property|real[- ]?estate|riyadh|jeddah|شقة|فيلا|عقار|الرياض|جدة/i;

/** Any word that would prove a clinic template leaked into the shell. */
const CLINIC_TOKENS =
  /dental|dermatolog|physiotherap|clinic|appointment|طبيب|عيادة|أسنان|موعد/i;

function allText(p: {
  greeting: string;
  subtitle: string;
  suggestedPrompts: string[];
  example: string[];
}): string {
  return [p.greeting, p.subtitle, ...p.suggestedPrompts, ...p.example].join(" \n ");
}

test("a clinic org NEVER receives real-estate prompts / welcome / subtitle", () => {
  for (const dict of [EN, AR]) {
    const p = resolveChatPresentation({
      industrySlug: "clinic",
      businessName: "Bright Smile Clinic",
      dict,
    });
    assert.equal(p.industrySlug, "clinic");
    assert.ok(!REAL_ESTATE_TOKENS.test(allText(p)), "clinic shell has real-estate words");
    assert.ok(p.suggestedPrompts.length > 0, "clinic has its own starter prompts");
  }
});

test("a real-estate org receives its OWN prompts (and no clinic content)", () => {
  for (const dict of [EN, AR]) {
    const p = resolveChatPresentation({
      industrySlug: "real-estate",
      businessName: "Acme Properties",
      dict,
    });
    assert.equal(p.industrySlug, "real-estate");
    assert.ok(REAL_ESTATE_TOKENS.test(allText(p)), "real-estate shell should mention property");
    assert.ok(!CLINIC_TOKENS.test(allText(p)), "real-estate shell has clinic words");
  }
});

test("switching the industry slug switches the whole presentation", () => {
  const re = resolveChatPresentation({ industrySlug: "real-estate", businessName: null, dict: EN });
  const clinic = resolveChatPresentation({ industrySlug: "clinic", businessName: null, dict: EN });
  assert.notDeepEqual(re.suggestedPrompts, clinic.suggestedPrompts);
  assert.notEqual(re.greeting, clinic.greeting);
  assert.notEqual(re.subtitle, clinic.subtitle);
});

test("an unknown / null industry → the NEUTRAL generic fallback, never real-estate", () => {
  for (const slug of [null, "unknown-industry", "", "REAL-ESTATE", "restaurant"]) {
    for (const dict of [EN, AR]) {
      const p = resolveChatPresentation({ industrySlug: slug, businessName: null, dict });
      assert.equal(p.industrySlug, null, `${slug} must not resolve to a template`);
      assert.deepEqual(p.suggestedPrompts, [], "generic has no starter prompts");
      assert.deepEqual(p.example, []);
      assert.ok(!REAL_ESTATE_TOKENS.test(allText(p)));
      assert.ok(!CLINIC_TOKENS.test(allText(p)));
    }
  }
});

test("the generic fallback greeting is the neutral required copy", () => {
  assert.equal(genericChatPresentation(EN).greeting, "Hi! How can I help you today?");
  assert.equal(genericChatPresentation(AR).greeting, "مرحبًا! كيف يمكنني مساعدتك اليوم؟");
});

test("D3: for an unknown stored industry the chat SHELL and the effective AI CONFIG degrade the SAME way — neither is real-estate", () => {
  for (const slug of ["legal", "restaurant", "unknown-industry", ""]) {
    // chat shell → neutral generic
    const shell = resolveChatPresentation({ industrySlug: slug, businessName: null, dict: EN });
    assert.equal(shell.industrySlug, null);
    assert.ok(!REAL_ESTATE_TOKENS.test(allText(shell)));

    // effective AI config → neutral generic template, NOT real-estate
    const cfg = getEffectiveConfig({ organizationId: "o", industryTemplateId: slug });
    assert.equal(cfg.templateSlug, "generic", `${slug}: AI config must be generic, not real-estate`);
    for (const reField of ["budget", "bedrooms", "propertyType", "financing"]) {
      assert.ok(
        !cfg.leadFields.some((f) => f.key === reField),
        `${slug}: the AI must not ask for the real-estate field "${reField}"`,
      );
    }
  }
});

test("P2: the dev debug-panel config resolution (ChatWindow) for a generic presentation is generic — never real-estate", () => {
  // ChatWindow does exactly: getEffectiveConfig({ organizationId: "ui", industryTemplateId: presentation.industrySlug ?? "" })
  const generic = resolveChatPresentation({ industrySlug: "unknown-thing", businessName: null, dict: EN });
  assert.equal(generic.industrySlug, null);
  const panelCfg = getEffectiveConfig({
    organizationId: "ui",
    industryTemplateId: generic.industrySlug ?? "",
  });
  assert.equal(panelCfg.templateSlug, "generic");
  assert.ok(!panelCfg.leadFields.some((f) => f.key === "budget"));

  // a real industry still resolves to its own template
  const clinic = resolveChatPresentation({ industrySlug: "clinic", businessName: null, dict: EN });
  assert.equal(
    getEffectiveConfig({ organizationId: "ui", industryTemplateId: clinic.industrySlug ?? "" }).templateSlug,
    "clinic",
  );
});

test("business name is passed through, trimmed, and blank → null", () => {
  assert.equal(
    resolveChatPresentation({ industrySlug: "clinic", businessName: "  Nova Clinic  ", dict: EN })
      .businessName,
    "Nova Clinic",
  );
  for (const blank of [null, "", "   "]) {
    assert.equal(
      resolveChatPresentation({ industrySlug: "clinic", businessName: blank, dict: EN }).businessName,
      null,
    );
  }
});

test("suggested prompts are capped at 4", () => {
  const p = resolveChatPresentation({ industrySlug: "real-estate", businessName: null, dict: EN });
  assert.ok(p.suggestedPrompts.length <= 4);
});

test("EN and AR industry shells differ (nothing left untranslated)", () => {
  for (const slug of ["real-estate", "clinic"]) {
    const enP = resolveChatPresentation({ industrySlug: slug, businessName: null, dict: EN });
    const arP = resolveChatPresentation({ industrySlug: slug, businessName: null, dict: AR });
    assert.notEqual(enP.greeting, arP.greeting);
    assert.notDeepEqual(enP.suggestedPrompts, arP.suggestedPrompts);
  }
});
