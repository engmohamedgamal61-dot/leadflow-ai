import type { Viewport } from "next";

/**
 * `viewport-fit=cover` scoped to `/embed/*` only — it lets the full-bleed
 * mobile widget panel use `env(safe-area-inset-*)` to clear the notch / home
 * indicator. Deliberately not set on the root layout: it would change how the
 * rest of the app renders on notched devices, which is outside this widget
 * pass's scope.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
