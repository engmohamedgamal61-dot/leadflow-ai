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
    api/chat/route.ts       POST endpoint — streams a Claude response as text
  components/chat/           Reusable chat UI components
  hooks/use-chat.ts          Conversation state, streaming, error handling
  lib/
    lead-scoring.ts          Deterministic 0–100 score + HOT/WARM/COLD (pure)
    lead-scoring.test.ts     node:test suite for the scoring model
    chat/
      anthropic.ts           Anthropic client factory + model config
      system-prompt.ts       Lead-qualification system prompt (from LEAD_FIELDS)
      lead-qualification.ts  The 8 fields a qualified lead should collect
      lead-extraction.ts     Structured LeadData extraction (Claude, second pass)
      api-assistant.ts       AssistantClient backed by /api/chat (default)
      mock-assistant.ts      Dependency-free AssistantClient for dev/tests
      mock-data.ts           Greeting, suggested prompts, example conversation
  types/chat.ts              Shared types (ChatMessage, LeadData) + contracts
```

## Lead scoring

`src/lib/lead-scoring.ts` turns a `LeadData` object into a `LeadScore`
**deterministically, in application code** — Claude is never asked to score a
lead. It is a pure function:

```ts
calculateLeadScore(lead): {
  score: number,            // 0–100
  temperature: "HOT" | "WARM" | "COLD",
  breakdown: { intent, budget, location, property_type, bedrooms, financing, timeline },
}
```

| Category      | Max | Rule |
| ------------- | --- | ---- |
| intent        | 15  | buy = 15 · rent = 10 · null = 0 |
| budget (SAR)  | 20  | ≥1,000,000 = 20 · ≥500,000 = 15 · ≥250,000 = 10 · >0 = 5 · null = 0 |
| location      | 10  | known = 10 · null = 0 |
| property_type | 10  | known = 10 · null = 0 |
| bedrooms      | 10  | known = 10 · null = 0 |
| financing     | 15  | true = 15 · false = 10 · null = 0 |
| timeline      | 20  | ≤1 week = 20 · ≤1 month = 15 · ≤3 months = 10 · >3 months = 5 · null/unrecognised = 0 |

Temperature: **80–100 HOT · 50–79 WARM · 0–49 COLD**.

`timeline` is free text, so `classifyTimeline()` maps it to a bucket
deterministically (parses `N week/month/day/year`, plus a fixed keyword set for
phrases like "ASAP" or "end of year"). Edit `SCORE_WEIGHTS`,
`TEMPERATURE_THRESHOLDS`, or the `score*` helpers to tune the model — nothing
else depends on the internals. The `breakdown` is kept so a dashboard can
explain *why* a lead scored what it did.

Run the model's tests with `npm test`.

## How it works

1. The UI opens with a fixed greeting. On the first user message, `useChat`
   calls the injected `AssistantClient`.
2. `apiAssistant` POSTs the conversation to `/api/chat`.
3. The route validates the payload, calls Claude with `messages.stream`, and
   pipes text chunks back as `text/plain`.
4. `useChat` appends chunks to a placeholder assistant message as they arrive.

Swap the assistant by passing a different `AssistantClient` to `useChat` — the
components never touch the transport. Lead **scoring** and any CRM/automation
integrations are later phases.
