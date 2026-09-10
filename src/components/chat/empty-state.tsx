"use client";

import { AssistantAvatar } from "@/components/chat/assistant-avatar";
import { useI18n } from "@/i18n/client";

interface EmptyStateProps {
  /** Welcome heading — from the org's `ChatPresentation`. */
  greeting: string;
  /** One-line subtitle — from the org's `ChatPresentation`. */
  subtitle: string;
  /** Starter prompts — from the org's `ChatPresentation`. Empty → none shown. */
  suggestedPrompts: readonly string[];
  /** Whether an example conversation is available for this org. */
  hasExample: boolean;
  onSuggestionSelect: (prompt: string) => void;
  onLoadExample: () => void;
}

export function EmptyState({
  greeting,
  subtitle,
  suggestedPrompts,
  hasExample,
  onSuggestionSelect,
  onLoadExample,
}: EmptyStateProps) {
  const { t } = useI18n();

  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-10 text-center animate-message-in">
      <AssistantAvatar size="md" />
      <h2 className="mt-4 text-lg font-semibold tracking-tight">{greeting}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">{subtitle}</p>

      {suggestedPrompts.length > 0 ? (
        <div className="mt-6 flex w-full max-w-sm flex-col gap-2">
          {suggestedPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onSuggestionSelect(prompt)}
              className="rounded-xl border border-border bg-surface px-4 py-2.5 text-start text-sm text-foreground transition-colors hover:border-accent/60"
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      {hasExample ? (
        <button
          type="button"
          onClick={onLoadExample}
          className="mt-5 text-xs font-medium text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          {t("chat.seeExample")}
        </button>
      ) : null}
    </div>
  );
}
