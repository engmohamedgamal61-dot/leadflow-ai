import { loadChatPresentation } from "@/lib/chat/presentation.server";
import { ChatWindow } from "@/components/chat/chat-window";

export const dynamic = "force-dynamic";

/**
 * The default customer-chat surface. The presentation (welcome, subtitle,
 * starter prompts, business name) is resolved server-side from the current
 * request's organization — an authenticated member's org, the dev demo org,
 * or the neutral generic fallback. It is NEVER a fixed industry's copy.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const industryHint = typeof sp.industry === "string" ? sp.industry : null;

  const { presentation } = await loadChatPresentation({
    industryHint,
    widgetKey: null,
    widgetOrigin: null,
  });

  return <ChatWindow presentation={presentation} industryHint={industryHint} />;
}
