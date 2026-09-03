"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EMPTY_LEAD,
  type AssistantClient,
  type ChatMessage,
  type LeadData,
} from "@/types/chat";
import { getEffectiveConfig, type EffectiveConfig } from "@/lib/config";
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
  /** Industry template slug (e.g. "clinic"); default = server default. */
  industry?: string;
}

export interface UseChatResult {
  messages: ChatMessage[];
  status: ChatStatus;
  isResponding: boolean;
  error: string | null;
  /** The effective configuration this conversation runs on. */
  config: EffectiveConfig;
  /** Structured lead data extracted from the conversation so far. */
  lead: LeadData;
  sendMessage: (content: string) => Promise<void>;
  setConversation: (messages: ChatMessage[]) => void;
  reset: () => void;
}

export function useChat({
  initialMessages = [GREETING_MESSAGE],
  client = apiAssistant,
  industry,
}: UseChatOptions = {}): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lead, setLead] = useState<LeadData>(EMPTY_LEAD);

  const config = useMemo(
    () =>
      getEffectiveConfig(
        industry
          ? { organizationId: "ui", industryTemplateId: industry }
          : null,
      ),
    [industry],
  );

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
        const reply = await client.send(thread, {
          onToken: appendChunk,
          onLead: setLead,
          industry,
        });
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
    [client, industry],
  );

  const setConversation = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next;
    statusRef.current = "idle";
    setError(null);
    setStatus("idle");
    setLead(EMPTY_LEAD);
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
    config,
    lead,
    sendMessage,
    setConversation,
    reset,
  };
}
