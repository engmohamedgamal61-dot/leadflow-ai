/**
 * Per-widget conversation-id persistence in `localStorage`.
 *
 * Extracted from `use-chat.ts` so the validation/guard logic is independently
 * testable. A widget visitor who reloads or returns in the same browser
 * continues one server-side conversation (so their lead + messages accumulate
 * under one record). The id is an opaque UUID and NOT a read capability:
 * `/api/chat` only appends, and re-validates that the conversation belongs to
 * the widget's org, so a stale, corrupted, or cross-org id is simply ignored
 * and a fresh conversation is created — this module only needs to make sure a
 * garbage value is never trusted, never that it's "correct".
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function conversationStorageKey(widgetKey: string): string {
  return `leadflow:widget:${widgetKey}:conversation`;
}

/**
 * Read the stored conversation id for a widget key. `null` for: no
 * `widgetKey` (not the embeddable widget), no `window` (SSR), storage
 * unavailable/throws (private mode), nothing stored, or a stored value that
 * isn't a well-formed UUID (corrupted / tampered / from an old format) — a
 * garbage value is never handed to the server.
 */
export function readStoredConversationId(widgetKey?: string): string | null {
  if (!widgetKey || typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(conversationStorageKey(widgetKey));
    return v && UUID_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Persist (or clear, when `id` is `null`/invalid) the conversation id for a
 * widget key. No-op without a `widgetKey`/`window`, and swallows any storage
 * error (private mode, quota) — losing continuity is acceptable, breaking the
 * chat is not.
 */
export function writeStoredConversationId(
  widgetKey: string | undefined,
  id: string | null,
): void {
  if (!widgetKey || typeof window === "undefined") return;
  try {
    if (id && UUID_RE.test(id)) {
      window.localStorage.setItem(conversationStorageKey(widgetKey), id);
    } else {
      window.localStorage.removeItem(conversationStorageKey(widgetKey));
    }
  } catch {
    /* storage unavailable — the chat still works, just without continuity */
  }
}
