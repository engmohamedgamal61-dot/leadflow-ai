# LeadFlow AI

AI-powered lead qualification and sales automation.

A premium, dark, modern SaaS interface where a prospect can chat with LeadFlow AI
to get qualified for a property. Built with Next.js (App Router), TypeScript, and
Tailwind CSS.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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
  app/                     App Router entry (renders the chat)
  components/chat/          Reusable chat UI components
  hooks/use-chat.ts         Conversation state + assistant orchestration
  lib/chat/
    lead-qualification.ts   Fields a qualified lead should eventually collect
    mock-assistant.ts       Placeholder assistant (implements AssistantClient)
    mock-data.ts            Sample conversation + suggested prompts
  types/chat.ts             Shared chat types and the AssistantClient contract
```

## Status

Phase 2 — Lead Qualification Chat UI. The assistant is a **mock**: replies are
simulated and walk through the qualification questions. Real AI and backend
integrations are added in later phases. Any component that talks to the assistant
depends only on the `AssistantClient` interface, so the mock can be swapped for a
real client without UI changes.
