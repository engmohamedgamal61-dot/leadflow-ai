import type { IndustryTemplate } from "../types.ts";

/**
 * Generic — the NEUTRAL fallback template.
 *
 * It is deliberately NOT in the industry registry (`getIndustryTemplate` /
 * `hasIndustryTemplate` still return "unknown" for it), so onboarding and the
 * dashboard keep treating an unrecognised `industry_template_id` as "no
 * template configured". It exists only so the AI engine has a safe, industry-
 * neutral configuration to run on when an organization's stored industry slug
 * is missing or points at a template that no longer exists — instead of
 * silently borrowing real-estate's questions, fields and scoring.
 *
 * Captures the essentials any business needs (who, what they want, how to reach
 * them) and nothing industry-specific.
 */
export const genericTemplate: IndustryTemplate = {
  id: "template_generic",
  name: "General",
  nameKey: "industries.generic.name",
  slug: "generic",
  description:
    "A neutral lead-capture assistant with no industry-specific questions.",
  descriptionKey: "industries.generic.description",

  leadFields: [
    {
      key: "name",
      label: "Name",
      labelKey: "fields.name",
      type: "text",
      required: true,
      enabled: true,
      order: 10,
      description: "The person's name.",
      extractionHint:
        "The person's name, as they gave it. Keep the original script. null if not given.",
    },
    {
      key: "inquiry",
      label: "What they need",
      type: "text",
      required: true,
      enabled: true,
      order: 20,
      description: "A short summary of what the person is asking about.",
      extractionHint:
        "One or two sentences summarising what the person wants or needs help with, in their own words. null if unclear.",
    },
    {
      key: "phone",
      label: "Phone",
      labelKey: "fields.phone",
      type: "text",
      required: false,
      enabled: true,
      order: 30,
      description: "A contact phone number, digits only where possible.",
      extractionHint:
        "Phone number as digits (keep a leading + for country code). null if not given.",
    },
    {
      key: "email",
      label: "Email",
      labelKey: "fields.email",
      type: "text",
      required: false,
      enabled: true,
      order: 40,
      description: "A contact email address.",
      extractionHint: "Email address, lowercased. null if not given.",
    },
  ],

  qualificationFlow: [
    { fieldKey: "name", order: 10, required: true, questionHint: "the person's name" },
    {
      fieldKey: "inquiry",
      order: 20,
      required: true,
      questionHint: "what they're looking for or need help with",
    },
    {
      fieldKey: "phone",
      order: 30,
      required: false,
      questionHint: "the best phone number to reach them",
    },
    {
      fieldKey: "email",
      order: 40,
      required: false,
      questionHint: "an email address, if they prefer",
    },
  ],

  // Deterministic. Total max = 100.
  scoring: {
    rules: [
      { kind: "presence", fieldKey: "name", maxPoints: 20, points: 20, whenMissing: 0 },
      { kind: "presence", fieldKey: "inquiry", maxPoints: 40, points: 40, whenMissing: 0 },
      { kind: "presence", fieldKey: "phone", maxPoints: 25, points: 25, whenMissing: 0 },
      { kind: "presence", fieldKey: "email", maxPoints: 15, points: 15, whenMissing: 0 },
    ],
    thresholds: { hot: 80, warm: 50 },
  },

  aiBehavior: {
    persona: "a helpful, professional assistant",
    goal: "understand what the person needs and capture their contact details for the team to follow up",
    tone: "friendly, clear and professional; no exclamation overload and no emoji",
    style: "talk like a helpful person, one question at a time — not a form",
    languages: [
      "Arabic (Modern Standard and Gulf dialect)",
      "English",
    ],
    rules: [
      "Ask about exactly ONE thing per message — never bundle two questions together.",
      "Briefly acknowledge what the person said before asking the next thing.",
      "Keep every message short: one or two sentences.",
      "Detect the person's language and reply in that same language.",
      "Do not invent products, prices, availability, or commitments.",
      "Once you have their name, what they need, and a way to reach them, thank them and let them know the team will follow up.",
    ],
    domainContext:
      "This is a general lead-intake conversation; no specific industry is configured for this organization.",
  },
};
