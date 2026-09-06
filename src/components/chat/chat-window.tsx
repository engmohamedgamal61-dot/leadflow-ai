"use client";

import { useSyncExternalStore } from "react";
import type { ChatMessage } from "@/types/chat";
import { useChat } from "@/hooks/use-chat";
import { useI18n } from "@/i18n/client";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatComposer } from "@/components/chat/chat-composer";
import { EmptyState } from "@/components/chat/empty-state";
import { MessageList } from "@/components/chat/message-list";
import { LeadDebugPanel } from "@/components/chat/lead-debug-panel";

const NO_SUBSCRIBE = () => () => {};
const readIndustryFromUrl = (): string | undefined =>
  new URLSearchParams(window.location.search).get("industry") ?? undefined;

/**
 * Read an optional `?industry=<slug>` from the URL. A simple local way to run
 * the chat on a non-default industry template while proving the multi-industry
 * architecture; there is no persistence yet. SSR-safe (server sees no param).
 */
function useIndustryFromUrl(): string | undefined {
  return useSyncExternalStore(
    NO_SUBSCRIBE,
    readIndustryFromUrl,
    () => undefined,
  );
}

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

export function ChatWindow({ widgetKey }: { widgetKey?: string } = {}) {
  const { dict, tOptional } = useI18n();
  // A widget conversation is bound to the customer org by its key; the
  // `?industry=` demo switch does not apply.
  const industryFromUrl = useIndustryFromUrl();
  const industry = widgetKey ? undefined : industryFromUrl;
  const pageOrigin = useEmbeddingOrigin(Boolean(widgetKey));
  const {
    messages,
    status,
    isResponding,
    error,
    config,
    lead,
    sendMessage,
    setConversation,
    reset,
  } = useChat({
    industry,
    widgetKey,
    pageOrigin,
    greeting: dict.chat.greeting,
    errorFallback: dict.chat.errorGeneric,
    resolveError: (raw) =>
      raw.startsWith("chat.errors.")
        ? (tOptional(raw) ?? dict.chat.errorGeneric)
        : dict.chat.errorGeneric,
  });

  const hasUserMessages = messages.some((message) => message.role === "user");

  const loadExample = () => {
    const turns: ChatMessage[] = dict.chat.exampleConversation.map(
      (content, i) => ({
        id: `example-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content,
        createdAt: i + 1,
      }),
    );
    setConversation([
      { id: "greeting", role: "assistant", content: dict.chat.greeting, createdAt: 0 },
      ...turns,
    ]);
  };

  return (
    <div className="flex flex-1 items-center justify-center p-0 sm:p-6">
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden border-border bg-background sm:h-[min(760px,90vh)] sm:max-w-xl sm:rounded-2xl sm:border sm:shadow-2xl sm:shadow-black/40">
        <ChatHeader onReset={reset} canReset={hasUserMessages} />

        <div className="flex-1 overflow-y-auto">
          {hasUserMessages ? (
            <MessageList messages={messages} status={status} error={error} />
          ) : (
            <EmptyState
              onSuggestionSelect={sendMessage}
              onLoadExample={loadExample}
            />
          )}
        </div>

        <ChatComposer onSend={sendMessage} disabled={isResponding} />
      </div>

      <LeadDebugPanel lead={lead} config={config} />
    </div>
  );
}
