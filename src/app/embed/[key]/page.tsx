import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOrgByWidgetKey } from "@/lib/org/widget";
import { ChatWindow } from "@/components/chat/chat-window";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Chat",
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The per-organization embeddable chat widget. The `key` in the path is the
 * org's `widget_key`; it's validated server-side (unknown / disabled → 404).
 * `/api/chat` re-resolves the org from the same key on every turn, so the
 * conversation and any captured lead land in the right tenant — no session,
 * nothing the browser can widen.
 */
export default async function EmbedWidgetPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  if (!UUID_RE.test(key)) notFound();

  let ok = false;
  try {
    ok = (await resolveOrgByWidgetKey(createAdminClient(), key)) !== null;
  } catch {
    ok = false;
  }
  if (!ok) notFound();

  return (
    <main className="flex min-h-[100dvh] flex-col bg-background">
      <ChatWindow widgetKey={key} />
    </main>
  );
}
