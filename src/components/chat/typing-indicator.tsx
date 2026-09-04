"use client";

import { AssistantAvatar } from "@/components/chat/assistant-avatar";
import { useI18n } from "@/i18n/client";

export function TypingIndicator() {
  const { t } = useI18n();
  return (
    <div className="flex animate-message-in gap-3" aria-live="polite">
      <AssistantAvatar />
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-surface px-4 py-3.5">
        <span className="sr-only">{t("chat.typing")}</span>
        <Dot delay="0ms" />
        <Dot delay="150ms" />
        <Dot delay="300ms" />
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-typing-dot rounded-full bg-muted"
      style={{ animationDelay: delay }}
    />
  );
}
