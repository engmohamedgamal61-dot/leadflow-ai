/**
 * Build the copy-paste embed snippet for the website widget.
 *
 * Pure so the dashboard and its tests agree on exactly one string. The snippet
 * is a single classic `<script>` tag — the host site needs no framework and no
 * build step. `widget.js` reads its own `src` to find the app origin and the
 * `data-widget-key` attribute for the tenant.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `https://app.example` — trailing slashes trimmed; `""` when the base is unknown. */
export function normalizeAppOrigin(base: string | null | undefined): string {
  if (!base) return "";
  try {
    return new URL(base).origin;
  } catch {
    return String(base).replace(/\/+$/, "");
  }
}

/** URL of the loader script for a given app origin. */
export function widgetScriptUrl(appOrigin: string | null | undefined): string {
  return `${normalizeAppOrigin(appOrigin)}/widget.js`;
}

/** Direct URL of the widget panel — used by the dashboard "Preview" button. */
export function widgetPreviewUrl(
  appOrigin: string | null | undefined,
  widgetKey: string,
): string {
  return `${normalizeAppOrigin(appOrigin)}/embed/${widgetKey}`;
}

/**
 * The `<script …></script>` snippet. `widgetKey` must be a UUID (it is rendered
 * into an HTML attribute value); a bad key yields an empty string so the
 * dashboard never shows a broken snippet.
 */
export function widgetEmbedSnippet(
  appOrigin: string | null | undefined,
  widgetKey: string,
): string {
  if (!UUID_RE.test(widgetKey)) return "";
  return [
    `<script`,
    `  src="${widgetScriptUrl(appOrigin)}"`,
    `  data-widget-key="${widgetKey}"`,
    `  async`,
    `></script>`,
  ].join("\n");
}
