import type {
  AssistantClient,
  ChatMessage,
  SendOptions,
} from "@/types/chat";
import { getEffectiveConfig } from "@/lib/config";

const THINK_DELAY = 500;
const CHUNK_DELAY = 28;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Dependency-free stand-in for {@link apiAssistant}, kept for local development
 * and tests. It walks the prospect through the configured qualification flow —
 * one field per user turn — asking a plain question from each step's hint, and
 * streams the reply word by word so the UI behaves the same as against the API.
 */
export const mockAssistant: AssistantClient = {
  async send(
    messages: ChatMessage[],
    { onToken, industry }: SendOptions = {},
  ): Promise<string> {
    await wait(THINK_DELAY);

    const flow = getEffectiveConfig(
      industry
        ? { organizationId: "mock", industryTemplateId: industry }
        : null,
    ).qualificationFlow;
    const answered = messages.filter((m) => m.role === "user").length;
    const nextStep = flow[answered];
    const reply = nextStep
      ? `Thanks. Could you tell me about ${nextStep.questionHint ?? nextStep.fieldKey}?`
      : "Thanks — that's everything I need for now. A specialist will reach out shortly.";

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
