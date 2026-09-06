import type { ComponentType } from "react";
import { ChatIcon, RecoveryIcon, type IconProps } from "@/components/icons";
import { WhatsAppBrandIcon } from "@/components/icons/brands";

/**
 * Channel marks for a lead's `source`, keyed by the lowercase source string.
 * `whatsapp` is a real brand mark — the lead genuinely arrived over the
 * WhatsApp integration; web chat and recovery use the internal icon set.
 * Anything not listed here renders as plain text.
 */
const SOURCE_ICONS: Record<string, ComponentType<IconProps>> = {
  whatsapp: WhatsAppBrandIcon,
  chat: ChatIcon,
  web: ChatIcon,
  website: ChatIcon,
  recovery: RecoveryIcon,
};

/**
 * A lead's `source` string, prefixed with a small channel mark when the source
 * is one LeadFlow recognises. Pure — no hooks, no client boundary — so it
 * renders in both server and client components. The `source` text is passed
 * through verbatim (it's already shown raw everywhere else in the product).
 */
export function SourceMark({
  source,
  className,
}: {
  source: string | null;
  className?: string;
}) {
  if (!source) return <>—</>;
  const Icon = SOURCE_ICONS[source.toLowerCase()];
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`}>
      {Icon ? (
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted/70" aria-hidden />
      ) : null}
      <span>{source}</span>
    </span>
  );
}
