import type {
  AssistantClient,
  ChatMessage,
  SendOptions,
} from "@/types/chat";

const ENDPOINT = "/api/chat";

/** Abort a request that never makes progress so the UI can't lock up. */
const REQUEST_TIMEOUT_MS = 45_000;

const GENERIC_ERROR = "Something went wrong. Please try sending that again.";
const TIMEOUT_ERROR = "The assistant took too long to respond. Please try again.";
const INTERRUPTED_ERROR =
  "The connection was interrupted. Please try sending that again.";

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: unknown };
    if (typeof data?.error === "string" && data.error) return data.error;
  } catch {
    // fall through to a generic message
  }
  return GENERIC_ERROR;
}

/**
 * Assistant client backed by the `/api/chat` route, which streams a Claude
 * response back as plain-text chunks.
 *
 * Only ever surfaces short, user-facing strings — the route never sends stack
 * traces or secrets, and any transport failure is mapped to a generic message.
 * A stalled request is aborted after {@link REQUEST_TIMEOUT_MS}.
 */
export const apiAssistant: AssistantClient = {
  async send(
    messages: ChatMessage[],
    { signal, onToken }: SendOptions = {},
  ): Promise<string> {
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener("abort", onExternalAbort);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: messages.map(({ role, content }) => ({ role, content })),
          }),
          signal: controller.signal,
        });
      } catch {
        throw new Error(timedOut ? TIMEOUT_ERROR : GENERIC_ERROR);
      }

      if (!response.ok || !response.body) {
        throw new Error(await readError(response));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let full = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (chunk) {
            full += chunk;
            onToken?.(chunk);
          }
        }
      } catch {
        if (timedOut) throw new Error(TIMEOUT_ERROR);
        throw new Error(full ? INTERRUPTED_ERROR : GENERIC_ERROR);
      }

      return full;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onExternalAbort);
    }
  },
};
