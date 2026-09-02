import type { ChatMessage } from "@/types/chat";

let seq = 0;
/** Deterministic ids for seed data so server and client markup match. */
function seedMessage(role: ChatMessage["role"], content: string): ChatMessage {
  seq += 1;
  return { id: `seed-${seq}`, role, content, createdAt: seq };
}

export const ASSISTANT_GREETING = "Hi! 👋 How can I help you today?";

/** The message the assistant opens every new conversation with. */
export const GREETING_MESSAGE: ChatMessage = seedMessage(
  "assistant",
  ASSISTANT_GREETING,
);

/** Quick-start prompts shown in the empty state. */
export const SUGGESTED_PROMPTS: string[] = [
  "I'm looking for an apartment in Riyadh.",
  "I want to buy a villa in Jeddah.",
  "Do you have offices for rent in Riyadh?",
];

/**
 * Realistic mock conversation used to demonstrate the experience.
 * This is sample content only — it is not part of the runtime architecture
 * and will be replaced by real assistant responses in a later phase.
 */
export const EXAMPLE_CONVERSATION: ChatMessage[] = [
  seedMessage("assistant", ASSISTANT_GREETING),
  seedMessage("user", "I'm looking for an apartment in Riyadh."),
  seedMessage("assistant", "Great. Which area are you interested in?"),
  seedMessage("user", "North Riyadh."),
  seedMessage("assistant", "Perfect. What's your approximate budget?"),
  seedMessage("user", "Around 800,000 SAR."),
];
