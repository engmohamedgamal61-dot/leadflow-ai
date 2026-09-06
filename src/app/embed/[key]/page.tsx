import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOrgByWidgetKey } from "@/lib/org/widget";
import {
  devOriginsAllowed,
  evaluateWidgetOrigin,
} from "@/lib/org/widget-origin";
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

  let resolved: Awaited<ReturnType<typeof resolveOrgByWidgetKey>> = null;
  try {
    resolved = await resolveOrgByWidgetKey(createAdminClient(), key);
  } catch {
    resolved = null;
  }
  if (!resolved) notFound();

  // When another site frames this page, the browser sends the parent page as
  // `Referer` and marks the fetch cross-site. Require that origin to be on the
  // organization's allowlist. A direct visit (`same-origin` / `none` / a
  // browser too old to send `Sec-Fetch-Site`) is first-party and allowed — the
  // `/api/chat` turn is still origin-checked on every message.
  const h = await headers();
  const secFetchSite = h.get("sec-fetch-site");
  const framedExternally =
    secFetchSite === "cross-site" || secFetchSite === "same-site";
  if (framedExternally) {
    const decision = evaluateWidgetOrigin(
      h.get("referer"),
      resolved.allowedOrigins,
      { allowDevOrigins: devOriginsAllowed() },
    );
    if (!decision.allowed) notFound();
  }

  return (
    <main className="flex min-h-[100dvh] flex-col bg-background">
      <ChatWindow widgetKey={key} />
    </main>
  );
}
