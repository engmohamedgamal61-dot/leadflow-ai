export type MessageRole = "assistant" | "user";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
}

/**
 * Contract for anything that can produce assistant replies.
 * The mock implementation lives in `lib/chat/mock-assistant.ts`; a real
 * backend/AI client can implement the same interface later without touching
 * the UI.
 */
export interface AssistantClient {
  send(messages: ChatMessage[]): Promise<string>;
}
