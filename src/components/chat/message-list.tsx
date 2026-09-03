"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/types/chat";
import type { ChatStatus } from "@/hooks/use-chat";
import { MessageBubble } from "@/components/chat/message-bubble";
import { TypingIndicator } from "@/components/chat/typing-indicator";

interface MessageListProps {
  messages: ChatMessage[];
  status: ChatStatus;
  error: string | null;
}

export function MessageList({ messages, status, error }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  // An assistant message with no content yet is a placeholder for the reply
  // that is still being generated — represent it with the typing indicator.
  const visibleMessages = messages.filter(
    (message) => message.role !== "assistant" || message.content.length > 0,
  );

  return (
    <div className="flex flex-col gap-4 px-4 py-5 sm:px-6">
      {visibleMessages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}

      {status === "thinking" && <TypingIndicator />}

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
