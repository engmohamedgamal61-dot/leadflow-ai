export type MessageRole = "assistant" | "user";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
}

/** The minimal message shape exchanged with the chat API. */
export interface ChatTurn {
  role: MessageRole;
  content: string;
}

export interface SendOptions {
  /** Abort an in-flight request. */
  signal?: AbortSignal;
  /** Called with each streamed text chunk as it arrives. */
  onToken?: (chunk: string) => void;
}

/**
 * Contract for anything that can produce assistant replies.
 *
 * `apiAssistant` (lib/chat/api-assistant.ts) talks to the `/api/chat` route,
 * which calls Claude. `mockAssistant` (lib/chat/mock-assistant.ts) is a
 * dependency-free stand-in for local development and tests. The UI depends
 * only on this interface.
 */
export interface AssistantClient {
  send(messages: ChatMessage[], options?: SendOptions): Promise<string>;
}
