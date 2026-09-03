import type {
  AssistantClient,
  ChatMessage,
  SendOptions,
} from "@/types/chat";
import { LEAD_FIELDS } from "@/lib/chat/lead-qualification";

const THINK_DELAY = 500;
const CHUNK_DELAY = 28;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Dependency-free stand-in for {@link apiAssistant}, kept for local development
 * and tests. It walks the prospect through the lead-qualification questions in
 * order — one per user turn — and streams the reply word by word so the UI
 * behaves the same as it does against the real API.
 */
export const mockAssistant: AssistantClient = {
  async send(
    messages: ChatMessage[],
    { onToken }: SendOptions = {},
  ): Promise<string> {
    await wait(THINK_DELAY);

    const answered = messages.filter((m) => m.role === "user").length;
    const nextField = LEAD_FIELDS[answered + 1];
    const reply = nextField
      ? nextField.question
      : "Thanks — that's everything I need for now. One of our property specialists will reach out shortly with matching options.";

    if (!onToken) return reply;

    const words = reply.split(" ");
    let streamed = "";
    for (let i = 0; i < words.length; i += 1) {
      const chunk = i === 0 ? words[i] : ` ${words[i]}`;
      streamed += chunk;
      onToken(chunk);
      await wait(CHUNK_DELAY);
    }
    return streamed;
  },
};
