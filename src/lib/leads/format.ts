/**
 * Dashboard date formatting. Thin re-export of the locale-aware formatters in
 * `@/i18n/format` — kept as a module so existing `@/lib/leads/format` imports
 * don't churn. Callers pass the active locale; it defaults to `"en"`.
 */

export {
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  relativeTimeBucket,
  type RelativeTimeBucket,
} from "../../i18n/format.ts";
