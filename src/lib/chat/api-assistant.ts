import type {
  AssistantClient,
  ChatMessage,
  SendOptions,
} from "@/types/chat";

const ENDPOINT = "/api/chat";

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    if (data?.error) return data.error;
  } catch {
    // fall through to a generic message
  }
  return `Request failed (${response.status}).`;
}

/**
 * Assistant client backed by the `/api/chat` route, which streams a Claude
 * response back as plain-text chunks.
 */
export const apiAssistant: AssistantClient = {
  async send(
    messages: ChatMessage[],
    { signal, onToken }: SendOptions = {},
  ): Promise<string> {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages.map(({ role, content }) => ({ role, content })),
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(await readError(response));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) {
        full += chunk;
        onToken?.(chunk);
      }
    }

    return full;
  },
};
