"use client";

import { AssistantAvatar } from "@/components/chat/assistant-avatar";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { useI18n } from "@/i18n/client";

interface ChatHeaderProps {
  /** Business name — from the org's `ChatPresentation`. Falls back to the product name. */
  title?: string;
  /** One-line subtitle — from the org's `ChatPresentation`. */
  subtitle: string;
  onReset: () => void;
  canReset: boolean;
}

export function ChatHeader({ title, subtitle, onReset, canReset }: ChatHeaderProps) {
  const { t } = useI18n();

  // `pt-[calc(...)]` below clears the notch on a direct full-bleed mobile
  // /embed visit; env() is 0 everywhere else (including the desktop card
  // view), so this changes nothing there.
  return (
    <header className="flex items-center justify-between gap-3 border-b border-border px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-3 sm:px-6 sm:py-4">
      <div className="flex min-w-0 items-center gap-3">
        <AssistantAvatar size="md" />
        <div className="min-w-0 leading-tight">
          <p
            className="truncate text-sm font-semibold tracking-tight"
            title={title?.trim() || undefined}
          >
            {title?.trim() || t("chat.headerTitle")}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
            <span className="truncate">{subtitle}</span>
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
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
