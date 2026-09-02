import type { AssistantClient, ChatMessage } from "@/types/chat";
import { LEAD_FIELDS } from "@/lib/chat/lead-qualification";

const MIN_DELAY = 700;
const MAX_DELAY = 1400;

function randomDelay() {
  return MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);
}

/**
 * Placeholder assistant.
 *
 * It walks the prospect through the lead-qualification questions in order,
 * one per user turn, so the interface can be exercised end to end without a
 * backend. Swap this for a real client that calls an AI API — the rest of the
 * app only depends on the {@link AssistantClient} interface.
 */
export const mockAssistant: AssistantClient = {
  async send(messages: ChatMessage[]): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, randomDelay()));

    const answeredCount = messages.filter((m) => m.role === "user").length;
    // The greeting already covers the first field, so the next question is
    // offset by one.
    const nextField = LEAD_FIELDS[answeredCount + 1];

    if (nextField) {
      return nextField.question;
    }

    return "Thanks — that's everything I need for now. One of our property specialists will reach out shortly with matching options.";
  },
};
