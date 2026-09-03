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
  lib/chat/
    anthropic.ts             Anthropic client factory + model config
    system-prompt.ts         Lead-qualification system prompt (from LEAD_FIELDS)
    lead-qualification.ts    The 8 fields a qualified lead should collect
    api-assistant.ts         AssistantClient backed by /api/chat (default)
    mock-assistant.ts        Dependency-free AssistantClient for dev/tests
    mock-data.ts             Greeting, suggested prompts, example conversation
  types/chat.ts              Shared types + the AssistantClient contract
```

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
