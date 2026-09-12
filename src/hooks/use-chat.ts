"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_LEAD,
  type AssistantClient,
  type ChatMessage,
  type LeadData,
} from "@/types/chat";
import { apiAssistant } from "@/lib/chat/api-assistant";
import { ASSISTANT_GREETING } from "@/lib/chat/mock-data";
import {
  readStoredConversationId,
  writeStoredConversationId,
} from "@/lib/chat/widget-conversation-storage";

/** Deterministic id so the SSR and first client render agree. */
function greetingMessage(text: string): ChatMessage {
  return { id: "greeting", role: "assistant", content: text, createdAt: 0 };
}

export type ChatStatus = "idle" | "thinking" | "streaming";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createMessage(
  role: ChatMessage["role"],
  content: string,
): ChatMessage {
  return { id: newId(), role, content, createdAt: Date.now() };
}

interface UseChatOptions {
  initialMessages?: ChatMessage[];
  /** Defaults to the API-backed assistant; inject a mock for tests. */
  client?: AssistantClient;
  /** Industry template slug (e.g. "clinic"); default = server default. */
  industry?: string;
  /** Per-organization website widget key — set only for the embeddable widget. */
  widgetKey?: string;
  /** Embedding page origin (widget only) — checked against the org's allowlist. */
  pageOrigin?: string;
  /** Localized assistant greeting; the conversation opens with it and `reset` returns to it. */
  greeting?: string;
  /** Localized fallback shown when a send fails without a specific message. */
  errorFallback?: string;
  /**
   * Resolve an error identifier thrown by the assistant client (a
   * `chat.errors.*` key) into localized text. Defaults to identity.
   */
  resolveError?: (raw: string) => string;
}

export interface UseChatResult {
  messages: ChatMessage[];
  status: ChatStatus;
  isResponding: boolean;
  error: string | null;
  /** Structured lead data extracted from the conversation so far. */
  lead: LeadData;
  sendMessage: (content: string) => Promise<void>;
  setConversation: (messages: ChatMessage[]) => void;
  reset: () => void;
  /** Re-send the message that most recently failed. No-op if nothing failed. */
  retry: () => void;
}

export function useChat({
  initialMessages,
  client = apiAssistant,
  industry,
  widgetKey,
  pageOrigin,
  greeting = ASSISTANT_GREETING,
  errorFallback = "Something went wrong. Please try sending that again.",
  resolveError = (raw) => raw,
}: UseChatOptions = {}): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => initialMessages ?? [greetingMessage(greeting)],
  );
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lead, setLead] = useState<LeadData>(EMPTY_LEAD);

  // The persisted conversation id, returned by the server after the first
  // turn and echoed back on subsequent turns so the chat continues one
  // conversation. Kept in a ref — it is not rendered. For the embeddable
  // widget it is also restored from / written to localStorage (in an effect,
  // since refs must not be read/written during render) so the same visitor
  // continues one conversation across reloads.
  const conversationIdRef = useRef<string | null>(null);
  useEffect(() => {
    conversationIdRef.current = readStoredConversationId(widgetKey);
    // Only meaningful on mount — a mid-session widgetKey change isn't expected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // True from the moment a turn's visible reply finishes until that turn's
  // trailing conversationId arrives. The composer is re-enabled as soon as the
  // reply is done (see `onReplyEnd`), so this ref blocks a second send during
  // that short window — without it a fast follow-up could start before the
  // conversation is threaded and create a duplicate conversation server-side.
  const awaitingConversationRef = useRef(false);

  // Mirror state into refs (updated after commit) so the async `sendMessage`
  // callback can read the latest values without being re-created every render.
  const messagesRef = useRef(messages);
  const statusRef = useRef(status);
  useEffect(() => {
    messagesRef.current = messages;
    statusRef.current = status;
  }, [messages, status]);

  // The turn that most recently failed OR was generated but not saved (a
  // degraded persistence outcome — see `onPersistenceDegraded` below), for
  // the "Retry" button next to the error/warning message. Cleared on a
  // cleanly-saved send. Retrying reuses the ORIGINAL requestId, not a fresh
  // one: `persistChatTurn`'s idempotency guarantees (unique indexes keyed on
  // requestId / contact info — see src/lib/persistence/persist.ts) only
  // protect a request that's genuinely a replay of the same id. A degraded
  // turn may have partially persisted (e.g. the lead/conversation were
  // created but a later step failed) before throwing — resending with a
  // FRESH id would not find that partial row and could create a second,
  // duplicate lead/conversation instead of safely resuming it.
  const lastRetryableRef = useRef<{ content: string; requestId: string } | null>(null);

  const send = useCallback(
    async (content: string, requestId: string) => {
      const trimmed = content.trim();
      if (
        !trimmed ||
        statusRef.current !== "idle" ||
        awaitingConversationRef.current
      ) {
        return;
      }

      setError(null);
      const userMessage = createMessage("user", trimmed);
      const assistantMessage = createMessage("assistant", "");
      const thread = [...messagesRef.current, userMessage];

      messagesRef.current = [...thread, assistantMessage];
      statusRef.current = "thinking";
      setMessages(messagesRef.current);
      setStatus("thinking");

      const appendChunk = (chunk: string) => {
        statusRef.current = "streaming";
        setStatus("streaming");
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantMessage.id
              ? { ...message, content: message.content + chunk }
              : message,
          ),
        );
      };

      let degraded = false;

      try {
        const reply = await client.send(thread, {
          onToken: appendChunk,
          onReplyEnd: () => {
            // The visible reply is complete. Re-enable the composer now instead
            // of waiting for the post-reply lead extraction + persistence, and
            // hold the next turn until this turn's conversationId lands.
            awaitingConversationRef.current = true;
            statusRef.current = "idle";
            setStatus("idle");
          },
          onLead: setLead,
          onConversation: (id) => {
            conversationIdRef.current = id;
            writeStoredConversationId(widgetKey, id);
            awaitingConversationRef.current = false;
          },
          onPersistenceDegraded: () => {
            degraded = true;
          },
          industry,
          widgetKey,
          pageOrigin,
          conversationId: conversationIdRef.current ?? undefined,
          requestId,
        });
        // Ensure the final content is exact even if no chunks arrived.
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantMessage.id
              ? { ...message, content: reply }
              : message,
          ),
        );
        if (degraded) {
          // The reply succeeded and stays on screen — only a warning (with a
          // Retry affordance) is shown, unlike a full failure below, which
          // removes the assistant bubble entirely.
          lastRetryableRef.current = { content: trimmed, requestId };
          setError(resolveError("chat.errors.persistenceFailed"));
        } else {
          lastRetryableRef.current = null;
        }
      } catch (err) {
        lastRetryableRef.current = { content: trimmed, requestId };
        setError(
          err instanceof Error && err.message
            ? resolveError(err.message)
            : errorFallback,
        );
        setMessages((prev) =>
          prev.filter((message) => message.id !== assistantMessage.id),
        );
      } finally {
        // Never leave the next turn permanently blocked — e.g. if the stream
        // dropped before the trailing conversationId arrived.
        awaitingConversationRef.current = false;
        statusRef.current = "idle";
        setStatus("idle");
      }
    },
    [client, industry, widgetKey, pageOrigin, errorFallback, resolveError],
  );

  const sendMessage = useCallback(
    (content: string) => send(content, newId()),
    [send],
  );

  const setConversation = useCallback(
    (next: ChatMessage[]) => {
      messagesRef.current = next;
      statusRef.current = "idle";
      conversationIdRef.current = null;
      writeStoredConversationId(widgetKey, null);
      lastRetryableRef.current = null;
      setError(null);
      setStatus("idle");
      setLead(EMPTY_LEAD);
      setMessages(next);
    },
    [widgetKey],
  );

  const reset = useCallback(() => {
    setConversation([greetingMessage(greeting)]);
  }, [setConversation, greeting]);

  const retry = useCallback(() => {
    const retryable = lastRetryableRef.current;
    // Reuse the SAME requestId — see the comment on lastRetryableRef.
    if (retryable) void send(retryable.content, retryable.requestId);
  }, [send]);

  return {
    messages,
    status,
    isResponding: status !== "idle",
    error,
    lead,
    sendMessage,
    setConversation,
    reset,
    retry,
  };
}
