/**
 * Neutral fallback copy for the chat widget when it renders outside an
 * `<I18nProvider>` / without a server-resolved `ChatPresentation` (e.g. a unit
 * test). The real customer-facing strings come from `ChatPresentation`
 * (`lib/chat/presentation.ts`), resolved per organization. Nothing here is
 * industry-specific.
 */

export const ASSISTANT_GREETING = "Hi! How can I help you today?";
