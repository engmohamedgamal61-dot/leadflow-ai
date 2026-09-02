"use client";

import { useChat } from "@/hooks/use-chat";
import { EXAMPLE_CONVERSATION } from "@/lib/chat/mock-data";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatComposer } from "@/components/chat/chat-composer";
import { EmptyState } from "@/components/chat/empty-state";
import { MessageList } from "@/components/chat/message-list";

export function ChatWindow() {
  const {
    messages,
    isResponding,
    error,
    sendMessage,
    setConversation,
    reset,
  } = useChat();

  const hasUserMessages = messages.some((message) => message.role === "user");

  return (
    <div className="flex flex-1 items-center justify-center p-0 sm:p-6">
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden border-border bg-background sm:h-[min(760px,90vh)] sm:max-w-xl sm:rounded-2xl sm:border sm:shadow-2xl sm:shadow-black/40">
        <ChatHeader onReset={reset} canReset={hasUserMessages} />

        <div className="flex-1 overflow-y-auto">
          {hasUserMessages ? (
            <MessageList
              messages={messages}
              isResponding={isResponding}
              error={error}
            />
          ) : (
            <EmptyState
              onSuggestionSelect={sendMessage}
              onLoadExample={() => setConversation(EXAMPLE_CONVERSATION)}
            />
          )}
        </div>

        <ChatComposer onSend={sendMessage} disabled={isResponding} />
      </div>
    </div>
  );
}
