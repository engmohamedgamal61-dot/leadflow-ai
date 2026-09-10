"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { ChatMessage } from "@/types/chat";
import { useChat } from "@/hooks/use-chat";
import { useI18n } from "@/i18n/client";
import { getEffectiveConfig } from "@/lib/config";
import type { ChatPresentation } from "@/lib/chat/presentation";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatComposer } from "@/components/chat/chat-composer";
import { EmptyState } from "@/components/chat/empty-state";
import { MessageList } from "@/components/chat/message-list";
import { LeadDebugPanel } from "@/components/chat/lead-debug-panel";

const NO_SUBSCRIBE = () => () => {};

/**
 * The origin of the page that framed this widget. `ancestorOrigins` is the
 * exact parent-chain origin (Chromium/WebKit); `document.referrer` is the
 * cross-browser fallback. Used only to tell the server which site the widget
 * is embedded on so it can enforce the org's allowed-origins list. SSR-safe.
 */
const readEmbeddingOrigin = (): string | undefined => {
  try {
    const ancestors = window.location.ancestorOrigins;
    if (ancestors && ancestors.length > 0 && ancestors[0]) return ancestors[0];
  } catch {
    /* not supported — fall through */
  }
  try {
    if (document.referrer) return new URL(document.referrer).origin;
  } catch {
    /* malformed referrer */
  }
  return undefined;
};

function useEmbeddingOrigin(enabled: boolean): string | undefined {
  return useSyncExternalStore(
    NO_SUBSCRIBE,
    () => (enabled ? readEmbeddingOrigin() : undefined),
    () => undefined,
  );
}

export function ChatWindow({
  presentation,
  widgetKey,
  /** Dev-only demo switch, forwarded to `/api/chat` for the anonymous demo path. */
  industryHint,
}: {
  presentation: ChatPresentation;
  widgetKey?: string;
  industryHint?: string | null;
}) {
  const { dict, tOptional } = useI18n();
  const pageOrigin = useEmbeddingOrigin(Boolean(widgetKey));

  // The dev-only debug panel wants a config to show fields/scoring. Resolve it
  // from the server-decided industry slug (public static template data — NOT an
  // org id, so no cross-tenant risk). Stored per-org overrides are not applied
  // here; the panel is a dev aid, not the source of truth.
  const debugConfig = useMemo(
    () =>
      getEffectiveConfig(
        presentation.industrySlug
          ? { organizationId: "ui", industryTemplateId: presentation.industrySlug }
          : null,
      ),
    [presentation.industrySlug],
  );

  const {
    messages,
    status,
    isResponding,
    error,
    lead,
    sendMessage,
    setConversation,
    reset,
  } = useChat({
    industry: industryHint ?? undefined,
    widgetKey,
    pageOrigin,
    greeting: presentation.greeting,
    errorFallback: dict.chat.errorGeneric,
    resolveError: (raw) =>
      raw.startsWith("chat.errors.")
        ? (tOptional(raw) ?? dict.chat.errorGeneric)
        : dict.chat.errorGeneric,
  });

  const hasUserMessages = messages.some((message) => message.role === "user");

  const loadExample = () => {
    const turns: ChatMessage[] = presentation.example.map((content, i) => ({
      id: `example-${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content,
      createdAt: i + 1,
    }));
    setConversation([
      { id: "greeting", role: "assistant", content: presentation.greeting, createdAt: 0 },
      ...turns,
    ]);
  };

  return (
    <div className="flex flex-1 items-center justify-center p-0 sm:p-6">
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden border-border bg-background sm:h-[min(760px,90vh)] sm:max-w-xl sm:rounded-2xl sm:border sm:shadow-2xl sm:shadow-black/40">
        <ChatHeader
          title={presentation.businessName ?? undefined}
          subtitle={presentation.subtitle}
          onReset={reset}
          canReset={hasUserMessages}
        />

        <div className="flex-1 overflow-y-auto">
          {hasUserMessages ? (
            <MessageList messages={messages} status={status} error={error} />
          ) : (
            <EmptyState
              greeting={presentation.greeting}
              subtitle={presentation.subtitle}
              suggestedPrompts={presentation.suggestedPrompts}
              hasExample={presentation.example.length > 0}
              onSuggestionSelect={sendMessage}
              onLoadExample={loadExample}
            />
          )}
        </div>

        <ChatComposer onSend={sendMessage} disabled={isResponding} />
      </div>

      <LeadDebugPanel lead={lead} config={debugConfig} />
    </div>
  );
}
