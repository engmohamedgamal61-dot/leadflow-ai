import { AssistantAvatar } from "@/components/chat/assistant-avatar";
import { ASSISTANT_GREETING, SUGGESTED_PROMPTS } from "@/lib/chat/mock-data";

interface EmptyStateProps {
  onSuggestionSelect: (prompt: string) => void;
  onLoadExample: () => void;
}

export function EmptyState({
  onSuggestionSelect,
  onLoadExample,
}: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-10 text-center animate-message-in">
      <AssistantAvatar size="md" />
      <h2 className="mt-4 text-lg font-semibold tracking-tight">
        {ASSISTANT_GREETING}
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
        Tell LeadFlow AI what you&apos;re looking for and it will help narrow
        down the right property for you.
      </p>

      <div className="mt-6 flex w-full max-w-sm flex-col gap-2">
        {SUGGESTED_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onSuggestionSelect(prompt)}
            className="rounded-xl border border-border bg-surface px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:border-accent/60"
          >
            {prompt}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onLoadExample}
        className="mt-5 text-xs font-medium text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
      >
        See an example conversation
      </button>
    </div>
  );
}
