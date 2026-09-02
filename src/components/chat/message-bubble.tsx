import type { ChatMessage } from "@/types/chat";
import { AssistantAvatar } from "@/components/chat/assistant-avatar";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isAssistant = message.role === "assistant";

  return (
    <div
      className={`flex animate-message-in gap-3 ${
        isAssistant ? "justify-start" : "flex-row-reverse justify-start"
      }`}
    >
      {isAssistant ? (
        <AssistantAvatar />
      ) : (
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-[11px] font-semibold text-muted"
        >
          You
        </span>
      )}

      <div
        className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed sm:max-w-[70%] ${
          isAssistant
            ? "rounded-tl-sm bg-surface text-foreground"
            : "rounded-tr-sm bg-accent text-accent-foreground"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
