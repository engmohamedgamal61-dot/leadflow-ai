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
  components/chat/           Reusable chat UI components
  hooks/use-chat.ts          Conversation state, streaming, error handling
  lib/
    lead-scoring.ts          Deterministic 0–100 score engine (config-driven, pure)
    lead-scoring.test.ts     node:test suite for the scoring engine
    config/                  Configuration-driven industry model
      types.ts               IndustryTemplate, LeadFieldDefinition, ScoringRule, …
      registry.ts            getIndustryTemplate(slug) / listIndustryTemplates()
      effective-config.ts    resolveEffectiveConfig(template, orgConfig?)
      validate.ts            Template / effective-config validation (never throws)
      index.ts               getEffectiveConfig() — what the engine runs on
      templates/real-estate.ts   The first industry template
      config.test.ts         node:test suite for the config layer
    chat/
      anthropic.ts           Anthropic client factory + model config
      system-prompt.ts       buildSystemPrompt(config) — persona/rules from config
      lead-extraction.ts     Structured LeadData extraction, schema from config
      api-assistant.ts       AssistantClient backed by /api/chat (default)
      mock-assistant.ts      Dependency-free AssistantClient for dev/tests
      mock-data.ts           Greeting, suggested prompts, example conversation
  types/chat.ts              Shared types (ChatMessage, LeadData) + contracts
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
  Estate is the only one so far; clinics / automotive / education slot in as
  more template objects with zero engine changes.
- **`OrganizationConfig`** describes how one org customizes a template —
  field overrides, flow overrides, scoring overrides, AI-behaviour overrides.
  No persistence yet; this is just the shape a DB row will take.
- **`getEffectiveConfig(org?)`** merges the two. The chat route, the extraction
  schema, the system prompt and the scoring engine all consume this object —
  none of them mention "real estate".

`getIndustryTemplate("real-estate")` is the access point; templates move to a
database later by changing only `registry.ts`.

## Lead scoring

`calculateLeadScore(lead, scoring)` turns a lead into a `LeadScore`
**deterministically, in application code** — Claude is never asked to score a
lead:

```ts
{
  score: number,            // 0–100
  temperature: "HOT" | "WARM" | "COLD",
  breakdown: { intent, budget, location, property_type, bedrooms, financing, timeline },
}
```

The engine is generic — it evaluates the `ScoringRule`s from the effective
config (`match` / `presence` / `boolean` / `numericThreshold` / `bucket`) and
sums the points. The Real Estate model lives in
`templates/real-estate.ts` → `scoring`:

| Field         | Max | Rule |
| ------------- | --- | ---- |
| intent        | 15  | buy = 15 · rent = 10 · null = 0 |
| budget (SAR)  | 20  | ≥1,000,000 = 20 · ≥500,000 = 15 · ≥250,000 = 10 · >0 = 5 · null = 0 |
| location      | 10  | known = 10 · null = 0 |
| property_type | 10  | known = 10 · null = 0 |
| bedrooms      | 10  | known = 10 · null = 0 |
| financing     | 15  | true = 15 · false = 10 · null = 0 |
| timeline      | 20  | ≤1 week = 20 · ≤1 month = 15 · ≤3 months = 10 · >3 months = 5 · null/unrecognised = 0 |

Temperature: **80–100 HOT · 50–79 WARM · 0–49 COLD** (also from the config's
`thresholds`).

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
