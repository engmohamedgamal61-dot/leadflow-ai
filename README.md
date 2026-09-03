# LeadFlow AI

AI-powered lead qualification and sales automation.

A premium, dark, modern SaaS interface where a prospect chats with LeadFlow AI
and is qualified for a property. Built with Next.js (App Router), TypeScript, and
Tailwind CSS. The assistant is powered by Claude via a streaming route handler.

## Getting started

```bash
npm install
cp .env.example .env.local   # then add your ANTHROPIC_API_KEY
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment

| Variable            | Required | Description                                                        |
| ------------------- | -------- | ------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY` | Yes      | Anthropic API key. Without it, `/api/chat` returns a 503.          |
| `ANTHROPIC_MODEL`   | No       | Chat model. Defaults to `claude-opus-5`; `claude-sonnet-5` or `claude-haiku-4-5` are cheaper for a high-volume widget. |

## Scripts

| Command         | Description                     |
| --------------- | ------------------------------- |
| `npm run dev`   | Start the development server    |
| `npm run build` | Production build                |
| `npm run start` | Serve the production build      |
| `npm run lint`  | Run ESLint                      |

## Project structure

```
src/
  app/
    page.tsx                Renders the chat
    api/chat/route.ts       POST endpoint — streams a reply, then a lead JSON
  components/chat/           Reusable chat UI components (industry-agnostic)
  hooks/use-chat.ts          Conversation state, streaming, error handling
  lib/
    lead-normalization.ts    assembleLead(raw, config) — generic, type-driven
    lead-schema.ts           buildLeadSchema(fields) — extraction schema from config
    lead-scoring.ts           Deterministic 0–100 score engine (config-driven, pure)
    *.test.ts                 node:test suites (normalization / schema / scoring)
    config/                   Configuration-driven industry model
      types.ts               IndustryTemplate, LeadFieldDefinition, ScoringRule, …
      registry.ts            getIndustryTemplate(slug) / listIndustryTemplates()
      effective-config.ts    resolveEffectiveConfig(template, orgConfig?)
      validate.ts            Template / effective-config validation (never throws)
      index.ts               getEffectiveConfig() — what the engine runs on
      templates/real-estate.ts   First industry template
      templates/clinic.ts        Second industry template (proof of architecture)
      config.test.ts         node:test suite for the config layer
    chat/
      anthropic.ts           Anthropic client factory + model config
      system-prompt.ts       buildSystemPrompt(config) — persona/rules from config
      lead-extraction.ts     Claude call → assembleLead (industry-blind)
      api-assistant.ts       AssistantClient backed by /api/chat (default)
      mock-assistant.ts      Dependency-free AssistantClient for dev/tests
      mock-data.ts           Greeting, suggested prompts, example conversation
  types/chat.ts              LeadData (generic), getLeadFieldValue, contracts
```

## Configuration-driven architecture

LeadFlow is an AI lead-automation platform, not a real-estate app. An industry
is **data**, never branching logic:

```
IndustryTemplate  →  + OrganizationConfig overrides  →  EffectiveConfig
     (defaults)              (customization)              (what runs)
```

- **`IndustryTemplate`** (`src/lib/config/templates/`) bundles an industry's
  `leadFields`, `qualificationFlow`, `scoring` rules and `aiBehavior`. Real
  Estate and Clinic ship today; automotive / education / legal slot in as more
  template objects plus one registry line — zero engine changes.
- **`OrganizationConfig`** describes how one org customizes a template —
  field overrides, flow overrides, scoring overrides, AI-behaviour overrides.
  No persistence yet; this is just the shape a DB row will take.
- **`getEffectiveConfig(org?)`** merges the two. The system prompt, the
  extraction schema, the normalizer and the scoring engine all consume this
  object — none of them mention "real estate" or "clinic".

`getIndustryTemplate(slug)` is the access point; templates move to a database
later by changing only `registry.ts`.

### The lead pipeline is generic

```
conversation → Claude → extraction (schema from config.leadFields)
            → assembleLead(raw, config)  →  generic LeadData
            → calculateLeadScore(lead, config.scoring)  →  score + temperature
```

**`LeadData`** has a small universal **core** — `name`, `phone`, `email`,
`intent` — and everything industry-specific in `customData`:

```json
{ "name": "محمد", "phone": null, "email": null, "intent": "buy",
  "customData": { "location": "Riyadh", "budget": 1000000,
    "property_type": "apartment", "bedrooms": 4, "financing": true,
    "timeline": "1 week" } }
```

- **Extraction** — `buildLeadSchema()` turns `config.leadFields` into the
  structured-output JSON schema. The extraction engine never names a field.
- **Normalization** — `assembleLead()` normalizes each value by its
  `LeadFieldDefinition.type` (`number` parses "1 million" / "١٠٠٠٠٠٠"; `boolean`
  parses "yes" / "نعم"; `select` matches option values / labels / `aliases`).
  No `if (fieldKey === "budget")` anywhere.
- **Scoring** — `calculateLeadScore()` resolves each rule's `fieldKey` with
  `getLeadFieldValue(lead, key)`, which reads a core field or a `customData`
  field transparently.

Run the chat on another industry with `?industry=clinic` (local dev
convenience — no persistence).

## Lead scoring

`calculateLeadScore(lead, scoring)` turns a lead into a `LeadScore`
**deterministically, in application code** — Claude is never asked to score a
lead:

```ts
{
  score: number,            // 0–100
  temperature: "HOT" | "WARM" | "COLD",
  breakdown: Record<fieldKey, number>,   // points per scoring rule
}
```

The engine is generic — it evaluates the `ScoringRule`s from the effective
config (`match` / `presence` / `boolean` / `numericThreshold` / `bucket`),
resolving each rule's value through `getLeadFieldValue`, and sums the points.
Each industry template carries its own `scoring` block and temperature
thresholds. The Real Estate model (`templates/real-estate.ts` → `scoring`):

| Field         | Max | Rule |
| ------------- | --- | ---- |
| intent        | 15  | buy = 15 · rent = 10 · null = 0 |
| budget (SAR)  | 20  | ≥1,000,000 = 20 · ≥500,000 = 15 · ≥250,000 = 10 · >0 = 5 · null = 0 |
| location      | 10  | known = 10 · null = 0 |
| property_type | 10  | known = 10 · null = 0 |
| bedrooms      | 10  | known = 10 · null = 0 |
| financing     | 15  | true = 15 · false = 10 · null = 0 |
| timeline      | 20  | ≤1 week = 20 · ≤1 month = 15 · ≤3 months = 10 · >3 months = 5 · null/unrecognised = 0 |

And the Clinic model (`templates/clinic.ts` → `scoring`):

| Field            | Max | Rule |
| ---------------- | --- | ---- |
| service          | 20  | known = 20 · null = 0 |
| doctor           | 15  | known = 15 · null = 0 |
| appointment_date | 25  | known = 25 · null = 0 |
| insurance        | 15  | true = 15 · false = 5 · null = 0 |
| urgency          | 25  | high = 25 · medium = 15 · low = 5 · null = 0 |

Temperature: **80–100 HOT · 50–79 WARM · 0–49 COLD** — from each template's
`scoring.thresholds`.

`timeline` is free text, so `classifyTimeline()` maps it to a bucket
deterministically (parses `N week/month/day/year`, plus a fixed keyword set for
phrases like "ASAP" or "end of year"). To tune a model, edit that industry
template's `scoring` block — nothing else changes. The `breakdown` is kept so a
dashboard can explain *why* a lead scored what it did.

Run the test suites (`config/` + scoring) with `npm test`.

## How it works

1. The UI opens with a fixed greeting. On the first user message, `useChat`
   calls the injected `AssistantClient`.
2. `apiAssistant` POSTs the conversation to `/api/chat`.
3. The route validates the payload, calls Claude with `messages.stream`, and
   pipes text chunks back as `text/plain`.
4. `useChat` appends chunks to a placeholder assistant message as they arrive.

Swap the assistant by passing a different `AssistantClient` to `useChat` — the
components never touch the transport. Supabase persistence and any
CRM/automation integrations are later phases.
