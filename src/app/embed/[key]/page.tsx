import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveOrgByWidgetKey } from "@/lib/org/widget";
import {
  devOriginsAllowed,
  evaluateWidgetOrigin,
} from "@/lib/org/widget-origin";
import { getDictionary } from "@/i18n/server";
import { resolveChatPresentation } from "@/lib/chat/presentation";
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
 * org's `widget_key`; it's validated server-side. A malformed key is a real
 * 404; an unknown / disabled / suspended-org key or a blocked origin render a
 * neutral, on-brand "chat unavailable" panel instead — a visitor must never
 * see a raw framework error page inside the widget. `/api/chat` re-resolves
 * the org from the same key on every turn, so the conversation and any
 * captured lead land in the right tenant — no session, nothing the browser
 * can widen.
 */
export default async function EmbedWidgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { key } = await params;
  // A malformed key never maps to a row — a real 404, no reason to dress it up.
  if (!UUID_RE.test(key)) notFound();

  const sp = await searchParams;
  // `widget.js` appends the embedding page's origin — a reliable signal even
  // when `Referrer-Policy` strips the `Referer` header.
  const parentOrigin =
    typeof sp.parentOrigin === "string" ? sp.parentOrigin.slice(0, 2048) : null;
  const dict = await getDictionary();

  let resolved: Awaited<ReturnType<typeof resolveOrgByWidgetKey>> = null;
  try {
    resolved = await resolveOrgByWidgetKey(createAdminClient(), key);
  } catch {
    resolved = null;
  }
  // Unknown / disabled / suspended-org all resolve to `null` identically (by
  // design — distinguishing them would let a scanner tell "exists but off"
  // from "never existed"). Render one neutral, on-brand state instead of a
  // raw framework 404 inside the panel; nothing here reveals which case it was.
  if (!resolved) {
    return <WidgetUnavailable title={dict.widget.unavailable.title} body={dict.widget.unavailable.body} />;
  }

  // When another site frames this page, the browser marks the navigation
  // cross-site. Check the embedding origin (the widget script's `?parentOrigin`,
  // falling back to `Referer`) against the org's allowlist. An empty allowlist
  // allows every site (MVP); a configured one is strictly enforced. A direct
  // visit (`same-origin` / `none`) is first-party — the `/api/chat` turn is
  // still origin-checked on every message.
  const h = await headers();
  const secFetchSite = h.get("sec-fetch-site");
  const framedExternally =
    secFetchSite === "cross-site" || secFetchSite === "same-site";
  if (framedExternally) {
    const decision = evaluateWidgetOrigin(
      parentOrigin ?? h.get("referer"),
      resolved.allowedOrigins,
      { allowDevOrigins: devOriginsAllowed(), emptyAllowsAll: true },
    );
    if (!decision.allowed) {
      // The org DOES exist and IS enabled — just not authorised for this site.
      // A more specific message helps the site owner debug their own embed;
      // it never reveals which origins ARE allowed.
      return (
        <WidgetUnavailable
          title={dict.widget.unavailable.originBlockedTitle}
          body={dict.widget.unavailable.originBlockedBody}
        />
      );
    }
  }

  // The customer org is now trusted (resolved server-side from the widget key).
  // Build its chat presentation — its own template's copy, its own name.
  const presentation = resolveChatPresentation({
    industrySlug: resolved.industryTemplateId,
    businessName: resolved.organizationName,
    dict,
  });

  return (
    <main className="flex min-h-[100dvh] flex-col bg-background">
      <ChatWindow
        widgetKey={key}
        presentation={presentation}
        pageOriginHint={parentOrigin ?? undefined}
      />
    </main>
  );
}

/**
 * The neutral state rendered inside the widget panel when the widget can't
 * run (unknown / disabled / suspended org, or a blocked embedding origin) —
 * on-brand and calm rather than a raw framework error page. Never mentions
 * which of those cases it was.
 */
function WidgetUnavailable({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-2 bg-background px-6 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="max-w-xs text-sm text-muted">{body}</p>
    </main>
  );
}
