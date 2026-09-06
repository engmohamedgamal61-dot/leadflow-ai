import type { ComponentType, SVGProps } from "react";
import type { IconProps } from "./index";

/**
 * Brand marks for third-party integrations and communication channels.
 *
 * Unlike the internal icon set in `./index.tsx` (monochrome, `currentColor`,
 * 1.5px stroke), these carry each brand's recognizable colour *inside the
 * glyph*. They're simplified, single-purpose reproductions — enough to be
 * recognizable at chip size, nothing more. Keep them on a neutral chip
 * (`border border-border bg-surface`) so the colour stays contained and the
 * rest of the dashboard stays visually restrained.
 *
 * Only render a brand icon where the integration/channel is actually present
 * in the data. The registry below also holds marks for integrations LeadFlow
 * doesn't ship yet (Gmail, Slack, …) so a future feature can light them up
 * without touching this file — but nothing renders them until then.
 *
 * Sizing: `1em` by default like the internal set; pass `className="h-4 w-4"`.
 */

function Svg({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/* ── Shipped integrations ──────────────────────────────────────────────── */

export function WhatsAppBrandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="#25D366"
        d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 2.1.55 4.05 1.6 5.77L2 22l4.45-1.16a9.9 9.9 0 0 0 5.58 1.7h.01c5.46 0 9.9-4.45 9.91-9.91a9.86 9.86 0 0 0-2.9-7.01A9.82 9.82 0 0 0 12.04 2Z"
      />
      <path
        fill="#fff"
        d="M9.53 7.33c-.19-.42-.38-.43-.56-.44l-.48-.01c-.16 0-.43.06-.66.31-.23.25-.87.85-.87 2.08 0 1.22.9 2.41 1.02 2.57.13.17 1.75 2.8 4.32 3.82 2.13.84 2.57.67 3.03.63.46-.04 1.49-.61 1.7-1.19.21-.59.21-1.09.15-1.19-.07-.1-.23-.17-.48-.29-.25-.13-1.49-.74-1.72-.82-.23-.08-.4-.13-.56.13-.17.25-.65.82-.79.99-.15.17-.29.19-.54.06-.25-.13-1.06-.39-2.02-1.25-.75-.67-1.25-1.49-1.4-1.74-.15-.25-.02-.39.11-.51.11-.11.25-.29.38-.44.12-.15.16-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.55-1.38-.78-1.87Z"
      />
    </Svg>
  );
}

export function GoogleCalendarBrandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      {/* card */}
      <rect x="4.5" y="5" width="15" height="15" rx="2.2" fill="#fff" stroke="#DADCE0" strokeWidth="1" />
      {/* Google-blue binding + coloured tabs */}
      <path d="M4.5 8.5h15" stroke="#DADCE0" strokeWidth="1" />
      <path fill="#4285F4" d="M4.5 7.2A2.2 2.2 0 0 1 6.7 5H9v3.5H4.5Z" />
      <path fill="#EA4335" d="M9 5h6v3.5H9z" />
      <path fill="#FBBC04" d="M15 5h2.3a2.2 2.2 0 0 1 2.2 2.2V8.5H15z" />
      {/* "31" */}
      <text
        x="12"
        y="16.6"
        textAnchor="middle"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="7"
        fontWeight="700"
        fill="#4285F4"
      >
        31
      </text>
    </Svg>
  );
}

/* ── Not shipped yet — registered, never rendered until a real feature exists ── */

export function GmailBrandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path fill="#fff" d="M4 6h16v12H4z" />
      <path fill="#EA4335" d="M4 6v2l8 5.5L20 8V6l-8 5.5z" />
      <path fill="#34A853" d="M4 8v10h3V10.2z" />
      <path fill="#FBBC04" d="M20 8v10h-3V10.2z" />
      <path fill="#4285F4" d="M4 6h3l5 3.5L17 6h3l-8 5.7z" opacity="0" />
      <path fill="#C5221F" d="M4 6l8 5.7V8L6.5 6z" opacity="0" />
    </Svg>
  );
}

export function SlackBrandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path fill="#36C5F0" d="M9 3.2a1.8 1.8 0 1 0 0 3.6h1.8V5A1.8 1.8 0 0 0 9 3.2Z" />
      <path fill="#2EB67D" d="M20.8 9a1.8 1.8 0 1 0-3.6 0v1.8H19A1.8 1.8 0 0 0 20.8 9Z" />
      <path fill="#ECB22E" d="M15 20.8a1.8 1.8 0 1 0 0-3.6h-1.8V19A1.8 1.8 0 0 0 15 20.8Z" />
      <path fill="#E01E5A" d="M3.2 15a1.8 1.8 0 1 0 3.6 0v-1.8H5A1.8 1.8 0 0 0 3.2 15Z" />
      <path fill="#2EB67D" d="M8.2 15a1.8 1.8 0 1 0 3.6 0V9a1.8 1.8 0 1 0-3.6 0Z" />
      <path fill="#ECB22E" d="M15 8.2a1.8 1.8 0 1 0 0 3.6h1.8V9A1.8 1.8 0 0 0 15 8.2Z" opacity="0" />
    </Svg>
  );
}

export function HubSpotBrandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="#FF7A59"
        d="M16.5 9.4V7.1a1.9 1.9 0 1 0-1.9-1.9v.2L9.4 8.2a4.6 4.6 0 1 0 .8 8.6l1.9 1.9a3.7 3.7 0 1 0 1.4-1.4l-1.9-1.9a4.6 4.6 0 0 0-.4-4.1l5-2.7a1.9 1.9 0 0 0 1 .3Zm-6 6.1a2.7 2.7 0 1 1 0-5.4 2.7 2.7 0 0 1 0 5.4Z"
      />
    </Svg>
  );
}

export function SalesforceBrandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="#00A1E0"
        d="M10.2 7.3a3.3 3.3 0 0 1 5.5.9 4 4 0 0 1 5 3.9 4 4 0 0 1-4 4c-.3 0-.6 0-.9-.1a2.9 2.9 0 0 1-5.2.3 3.3 3.3 0 0 1-4.5-3 3.3 3.3 0 0 1 2-3 3.3 3.3 0 0 1 2.1-3.2Z"
      />
    </Svg>
  );
}

export function FacebookBrandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="#1877F2"
        d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.5V12h2.8l-.4 2.9h-2.3v7A10 10 0 0 0 22 12Z"
      />
    </Svg>
  );
}

export function InstagramBrandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" fill="#E4405F" />
      <circle cx="12" cy="12" r="4" fill="none" stroke="#fff" strokeWidth="1.8" />
      <circle cx="16.6" cy="7.4" r="1.1" fill="#fff" />
    </Svg>
  );
}

export function LinkedInBrandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#0A66C2" />
      <path
        fill="#fff"
        d="M8 10.2v7H5.8v-7Zm-1.1-3.4a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6ZM18.2 17h-2.2v-3.6c0-.9-.3-1.5-1.1-1.5-.6 0-1 .4-1.1 .9-.1.2-.1.4-.1.6V17h-2.2s0-6.2 0-7h2.2v1c.3-.5.9-1.2 2.1-1.2 1.5 0 2.6 1 2.6 3.1Z"
      />
    </Svg>
  );
}

export function N8nBrandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="5.5" cy="12" r="2.2" fill="#EA4B71" />
      <circle cx="12" cy="7.5" r="2.2" fill="#EA4B71" />
      <circle cx="12" cy="16.5" r="2.2" fill="#EA4B71" />
      <circle cx="18.5" cy="12" r="2.2" fill="#EA4B71" />
      <path
        stroke="#EA4B71"
        strokeWidth="1.6"
        strokeLinecap="round"
        d="M7.5 11 10.3 8.6M7.6 13l2.7 2.4M13.7 8.6 16.5 11M13.7 15.4 16.4 13"
      />
    </Svg>
  );
}

/* ── Registry ──────────────────────────────────────────────────────────── */

/**
 * Stable slug → brand mark. Slugs match the identifiers the app already uses
 * for a channel/provider where one exists (`whatsapp`), otherwise a plain
 * lowercase name. `brandIcon()` returns `null` for anything unknown so callers
 * can fall back to the internal icon set.
 */
export const BRAND_ICONS = {
  whatsapp: WhatsAppBrandIcon,
  google_calendar: GoogleCalendarBrandIcon,
  gmail: GmailBrandIcon,
  slack: SlackBrandIcon,
  hubspot: HubSpotBrandIcon,
  salesforce: SalesforceBrandIcon,
  facebook: FacebookBrandIcon,
  instagram: InstagramBrandIcon,
  linkedin: LinkedInBrandIcon,
  n8n: N8nBrandIcon,
} as const satisfies Record<string, ComponentType<IconProps>>;

export type BrandKey = keyof typeof BRAND_ICONS;

export function brandIcon(key: string | null | undefined): ComponentType<IconProps> | null {
  if (!key) return null;
  return (BRAND_ICONS as Record<string, ComponentType<IconProps>>)[key] ?? null;
}
