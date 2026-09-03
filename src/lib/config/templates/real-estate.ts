import type { IndustryTemplate } from "../types.ts";

/**
 * Real Estate — the first industry template.
 *
 * This is the single source of truth for the behaviour LeadFlow shipped with:
 * the 8 lead fields, the qualification order, the deterministic scoring model,
 * and the assistant's persona / rules. Everything here previously lived as
 * hardcoded strings across `system-prompt.ts`, `lead-extraction.ts` and
 * `lead-scoring.ts`.
 *
 * Field keys match {@link LeadData} exactly, so no adapter is needed between a
 * `LeadFieldDefinition` and the extracted lead.
 */
export const realEstateTemplate: IndustryTemplate = {
  id: "template_real_estate",
  name: "Real Estate",
  slug: "real-estate",
  description:
    "Qualify inbound property buyers and renters: intent, area, budget, property type, bedrooms, financing and timeline.",

  leadFields: [
    {
      key: "name",
      label: "Name",
      type: "text",
      required: false,
      enabled: true,
      order: 10,
      description: "The prospect's first name.",
      extractionHint:
        "The prospect's name, as they gave it. Keep the original script.",
    },
    {
      key: "intent",
      label: "Intent",
      type: "select",
      required: true,
      enabled: true,
      order: 20,
      description: "Whether the prospect wants to buy or rent.",
      options: [
        { value: "buy", label: "Buy" },
        { value: "rent", label: "Rent" },
      ],
      extractionHint:
        'Exactly "buy" or "rent" (lowercase), or null. Infer from clear signals: financing/mortgage or a large purchase-sized budget imply "buy"; "rent"/"إيجار"/"للإيجار" imply "rent". null if genuinely unclear.',
    },
    {
      key: "location",
      label: "Location",
      type: "text",
      required: true,
      enabled: true,
      order: 30,
      description: "City or district the prospect is interested in.",
      extractionHint:
        'City or district, normalized to English (e.g. "Riyadh", "North Riyadh", "Jeddah").',
    },
    {
      key: "budget",
      label: "Budget",
      type: "number",
      required: true,
      enabled: true,
      order: 40,
      description: "Approximate budget in SAR.",
      extractionHint:
        'Numeric amount in SAR. "مليون ريال" -> 1000000, "800 ألف" -> 800000, "1.2m" -> 1200000.',
    },
    {
      key: "property_type",
      label: "Property type",
      type: "select",
      required: false,
      enabled: true,
      order: 50,
      description: "Kind of property, e.g. apartment, villa, townhouse.",
      options: [
        { value: "apartment", label: "Apartment" },
        { value: "villa", label: "Villa" },
        { value: "townhouse", label: "Townhouse" },
        { value: "office", label: "Office" },
        { value: "land", label: "Land" },
      ],
      extractionHint:
        'Lowercase English: "apartment", "villa", "townhouse", "office", "land", etc.',
    },
    {
      key: "bedrooms",
      label: "Bedrooms",
      type: "number",
      required: false,
      enabled: true,
      order: 60,
      description: "Number of bedrooms required.",
      extractionHint:
        "Integer number of bedrooms. Arabic-Indic digits count (٤ -> 4).",
    },
    {
      key: "financing",
      label: "Financing",
      type: "boolean",
      required: false,
      enabled: true,
      order: 70,
      description: "Whether the prospect needs financing or is paying cash.",
      extractionHint:
        "true if the prospect needs financing / a mortgage, false if paying cash. null if not mentioned.",
    },
    {
      key: "timeline",
      label: "Timeline",
      type: "text",
      required: true,
      enabled: true,
      order: 80,
      description: "When the prospect wants to move or buy.",
      extractionHint:
        'Short English phrase for when they want to move/buy: "1 week", "3 months", "ASAP", "end of year".',
    },
  ],

  qualificationFlow: [
    { fieldKey: "name", order: 10, required: false, questionHint: "the prospect's first name" },
    { fieldKey: "intent", order: 20, required: true, questionHint: "whether they want to buy or rent" },
    { fieldKey: "location", order: 30, required: true, questionHint: "which area or district they're interested in" },
    { fieldKey: "budget", order: 40, required: true, questionHint: "their approximate budget" },
    { fieldKey: "property_type", order: 50, required: false, questionHint: "what type of property (apartment, villa, townhouse, …)" },
    { fieldKey: "bedrooms", order: 60, required: false, questionHint: "how many bedrooms they need" },
    { fieldKey: "financing", order: 70, required: false, questionHint: "whether they'll pay cash or need financing" },
    { fieldKey: "timeline", order: 80, required: true, questionHint: "their ideal timeline to move or buy" },
  ],

  // Reproduces src/lib/lead-scoring.ts exactly. Total max = 100.
  scoring: {
    rules: [
      {
        kind: "match",
        fieldKey: "intent",
        maxPoints: 15,
        cases: { buy: 15, rent: 10 },
        whenMissing: 0,
      },
      {
        kind: "numericThreshold",
        fieldKey: "budget",
        maxPoints: 20,
        tiers: [
          { min: 1_000_000, points: 20 },
          { min: 500_000, points: 15 },
          { min: 250_000, points: 10 },
          { min: 0, points: 5 },
        ],
        whenMissing: 0,
      },
      { kind: "presence", fieldKey: "location", maxPoints: 10, points: 10, whenMissing: 0 },
      { kind: "presence", fieldKey: "property_type", maxPoints: 10, points: 10, whenMissing: 0 },
      { kind: "presence", fieldKey: "bedrooms", maxPoints: 10, points: 10, whenMissing: 0 },
      {
        kind: "boolean",
        fieldKey: "financing",
        maxPoints: 15,
        whenTrue: 15,
        whenFalse: 10,
        whenMissing: 0,
      },
      {
        kind: "bucket",
        fieldKey: "timeline",
        maxPoints: 20,
        classifier: "timeline",
        buckets: {
          within_1_week: 20,
          within_1_month: 15,
          within_3_months: 10,
          over_3_months: 5,
          unknown: 0,
        },
        whenMissing: 0,
      },
    ],
    thresholds: { hot: 80, warm: 50 },
  },

  aiBehavior: {
    persona: "a warm, sharp sales assistant for a real-estate brokerage",
    goal: "qualify inbound prospects through natural conversation and gather the details a human agent needs to follow up well",
    tone: "concise, friendly and professional; avoid exclamation overload and emoji",
    style: "talk like a helpful person, not a form — no numbered lists of questions, no \"question 1 of 8\"",
    languages: [
      "Arabic (Modern Standard and Gulf/Saudi dialect)",
      "English",
      "Arabizi (Arabic written in Latin letters/numbers, e.g. \"3ayez sha22a fe el riyad\")",
    ],
    rules: [
      "Ask about exactly ONE missing detail per message — never bundle two questions into one message (\"your name, and which area?\" is two questions).",
      "Read carefully and extract everything the prospect already told you, explicitly or implicitly. If they said \"3 bedroom apartment in North Riyadh, budget 800k\", you now know property type, bedrooms, location and budget. Never ask again for something you already have.",
      "Briefly acknowledge what the prospect just said before asking the next thing.",
      "Keep every message short: one or two sentences.",
      "It is fine to skip a detail the prospect doesn't want to share — move on.",
      "Detect the prospect's language and reply in that same language; if they write Arabizi, mirror their style.",
      "Never invent listings, prices, inventory or availability, and never promise anything about a specific property.",
      "Don't ask for contact details beyond a first name.",
      "If asked something off-topic, answer briefly, then steer back to qualification.",
      "Once you have a reasonable picture, thank the prospect, summarise what you understood in one line, and let them know a specialist will follow up shortly — don't keep interrogating.",
    ],
    domainContext:
      "Use local context naturally (e.g. SAR for budgets, Riyadh districts).",
  },
};
