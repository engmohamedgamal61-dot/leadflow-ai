"use client";

import { AssistantAvatar } from "@/components/chat/assistant-avatar";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { useI18n } from "@/i18n/client";

interface ChatHeaderProps {
  onReset: () => void;
  canReset: boolean;
}

export function ChatHeader({ onReset, canReset }: ChatHeaderProps) {
  const { t } = useI18n();

  return (
    <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6 sm:py-4">
      <div className="flex items-center gap-3">
        <AssistantAvatar size="md" />
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">
            {t("chat.headerTitle")}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {t("chat.headerSubtitle")}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <LanguageSwitcher size="compact" />
        <button
          type="button"
          onClick={onReset}
          disabled={!canReset}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("chat.newChat")}
        </button>
      </div>
    </header>
  );
}
