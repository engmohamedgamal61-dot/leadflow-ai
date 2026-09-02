"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssistantClient, ChatMessage } from "@/types/chat";
import { mockAssistant } from "@/lib/chat/mock-assistant";
import { GREETING_MESSAGE } from "@/lib/chat/mock-data";

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
  /** Defaults to the mock assistant; pass a real client in a later phase. */
  client?: AssistantClient;
}

export interface UseChatResult {
  messages: ChatMessage[];
  isResponding: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  setConversation: (messages: ChatMessage[]) => void;
  reset: () => void;
}

export function useChat({
  initialMessages = [GREETING_MESSAGE],
  client = mockAssistant,
}: UseChatOptions = {}): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [isResponding, setIsResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirror state into refs (updated after commit) so the async `sendMessage`
  // callback can read the latest thread without being re-created every render.
  const messagesRef = useRef(messages);
  const isRespondingRef = useRef(isResponding);
  useEffect(() => {
    messagesRef.current = messages;
    isRespondingRef.current = isResponding;
  }, [messages, isResponding]);

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || isRespondingRef.current) return;

      setError(null);
      const userMessage = createMessage("user", trimmed);
      const nextThread = [...messagesRef.current, userMessage];
      messagesRef.current = nextThread;
      isRespondingRef.current = true;
      setMessages(nextThread);
      setIsResponding(true);

      try {
        const reply = await client.send(nextThread);
        setMessages((prev) => [...prev, createMessage("assistant", reply)]);
      } catch {
        setError("Something went wrong. Please try sending that again.");
      } finally {
        isRespondingRef.current = false;
        setIsResponding(false);
      }
    },
    [client],
  );

  const setConversation = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next;
    isRespondingRef.current = false;
    setError(null);
    setIsResponding(false);
    setMessages(next);
  }, []);

  const reset = useCallback(() => {
    setConversation([GREETING_MESSAGE]);
  }, [setConversation]);

  return {
    messages,
    isResponding,
    error,
    sendMessage,
    setConversation,
    reset,
  };
}
