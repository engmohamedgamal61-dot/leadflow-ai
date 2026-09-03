import {
  LEAD_DELIMITER,
  type AssistantClient,
  type ChatMessage,
  type LeadData,
  type SendOptions,
} from "@/types/chat";

interface LeadTrailer {
  lead?: unknown;
  conversationId?: unknown;
}

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

function asText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toLeadData(value: unknown): LeadData | null {
  if (!value || typeof value !== "object") return null;
  const l = value as Partial<LeadData>;
  return {
    name: asText(l.name),
    phone: asText(l.phone),
    email: asText(l.email),
    intent: asText(l.intent),
    customData:
      l.customData && typeof l.customData === "object"
        ? (l.customData as Record<string, unknown>)
        : {},
  };
}

function parseTrailer(raw: string): {
  lead: LeadData | null;
  conversationId: string | null;
} {
  try {
    const data = JSON.parse(raw) as LeadTrailer;
    return {
      lead: toLeadData(data?.lead),
      conversationId:
        typeof data?.conversationId === "string" ? data.conversationId : null,
    };
  } catch {
    // ignore malformed trailer — the chat reply is unaffected
    return { lead: null, conversationId: null };
  }
}

/**
 * Assistant client backed by the `/api/chat` route.
 *
 * The response body is the streamed reply text, optionally followed by
 * `LEAD_DELIMITER` and a `{"lead": {...}, "conversationId": "..."}` JSON
 * trailer. Reply text is forwarded to `onToken` as it arrives; the trailer is
 * parsed and handed to `onLead` / `onConversation`.
 *
 * Only ever surfaces short, user-facing error strings — the route never sends
 * stack traces or secrets. A stalled request is aborted after
 * {@link REQUEST_TIMEOUT_MS}.
 */
export const apiAssistant: AssistantClient = {
  async send(
    messages: ChatMessage[],
    {
      signal,
      onToken,
      onLead,
      onConversation,
      industry,
      conversationId,
      requestId,
    }: SendOptions = {},
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
            ...(industry ? { industry } : {}),
            ...(conversationId ? { conversationId } : {}),
            ...(requestId ? { requestId } : {}),
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
      let reply = "";
      let leadTrailer = "";
      let sawDelimiter = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (!chunk) continue;

          if (sawDelimiter) {
            leadTrailer += chunk;
            continue;
          }

          const delimiterIndex = chunk.indexOf(LEAD_DELIMITER);
          if (delimiterIndex === -1) {
            reply += chunk;
            onToken?.(chunk);
          } else {
            sawDelimiter = true;
            const replyPart = chunk.slice(0, delimiterIndex);
            if (replyPart) {
              reply += replyPart;
              onToken?.(replyPart);
            }
            leadTrailer += chunk.slice(delimiterIndex + LEAD_DELIMITER.length);
          }
        }
      } catch {
        if (timedOut) throw new Error(TIMEOUT_ERROR);
        throw new Error(reply ? INTERRUPTED_ERROR : GENERIC_ERROR);
      }

      if (sawDelimiter) {
        const { lead, conversationId: newConversationId } =
          parseTrailer(leadTrailer);
        if (lead) onLead?.(lead);
        onConversation?.(newConversationId);
      }

      return reply;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onExternalAbort);
    }
  },
};
