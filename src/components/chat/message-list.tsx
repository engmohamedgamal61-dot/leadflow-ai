"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/types/chat";
import type { ChatStatus } from "@/hooks/use-chat";
import { useI18n } from "@/i18n/client";
import { MessageBubble } from "@/components/chat/message-bubble";
import { TypingIndicator } from "@/components/chat/typing-indicator";

interface MessageListProps {
  messages: ChatMessage[];
  status: ChatStatus;
  error: string | null;
  /** Re-send the message that failed. Omit to hide the retry affordance. */
  onRetry?: () => void;
}

export function MessageList({ messages, status, error, onRetry }: MessageListProps) {
  const { t } = useI18n();
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
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
        >
          <span>{error}</span>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="shrink-0 rounded-md border border-red-500/40 px-2 py-1 font-medium text-red-200 transition-colors hover:bg-red-500/20"
            >
              {t("common.retry")}
            </button>
          ) : null}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
