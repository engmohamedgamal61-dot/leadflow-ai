"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssistantClient, ChatMessage } from "@/types/chat";
import { apiAssistant } from "@/lib/chat/api-assistant";
import { GREETING_MESSAGE } from "@/lib/chat/mock-data";

export type ChatStatus = "idle" | "thinking" | "streaming";

function createMessage(
  role: ChatMessage["role"],
  content: string,
): ChatMessage {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    createdAt: Date.now(),
  };
}

interface UseChatOptions {
  initialMessages?: ChatMessage[];
  /** Defaults to the API-backed assistant; inject a mock for tests. */
  client?: AssistantClient;
}

export interface UseChatResult {
  messages: ChatMessage[];
  status: ChatStatus;
  isResponding: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  setConversation: (messages: ChatMessage[]) => void;
  reset: () => void;
}

export function useChat({
  initialMessages = [GREETING_MESSAGE],
  client = apiAssistant,
}: UseChatOptions = {}): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Mirror state into refs (updated after commit) so the async `sendMessage`
  // callback can read the latest values without being re-created every render.
  const messagesRef = useRef(messages);
  const statusRef = useRef(status);
  useEffect(() => {
    messagesRef.current = messages;
    statusRef.current = status;
  }, [messages, status]);

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || statusRef.current !== "idle") return;

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

      try {
        const reply = await client.send(thread, { onToken: appendChunk });
        // Ensure the final content is exact even if no chunks arrived.
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantMessage.id
              ? { ...message, content: reply }
              : message,
          ),
        );
      } catch (err) {
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Something went wrong. Please try sending that again.",
        );
        setMessages((prev) =>
          prev.filter((message) => message.id !== assistantMessage.id),
        );
      } finally {
        statusRef.current = "idle";
        setStatus("idle");
      }
    },
    [client],
  );

  const setConversation = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next;
    statusRef.current = "idle";
    setError(null);
    setStatus("idle");
    setMessages(next);
  }, []);

  const reset = useCallback(() => {
    setConversation([GREETING_MESSAGE]);
  }, [setConversation]);

  return {
    messages,
    status,
    isResponding: status !== "idle",
    error,
    sendMessage,
    setConversation,
    reset,
  };
}
