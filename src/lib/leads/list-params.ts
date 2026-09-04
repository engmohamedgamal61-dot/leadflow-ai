/**
 * Pure parsing + validation for the leads list URL state (search, filters,
 * pagination). No imports, no I/O — unit-tested and safe to run anywhere.
 *
 * Nothing here trusts the client: an unknown status/temperature is dropped, the
 * search term is sanitised before it can reach a PostgREST `or(...)` filter,
 * and the page is clamped to a sane range. There is deliberately no
 * `organizationId` — that is always resolved server-side from membership.
 */

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "qualified",
  "appointment",
  "won",
  "lost",
  "archived",
] as const;
export type LeadStatusValue = (typeof LEAD_STATUSES)[number];

export const LEAD_TEMPERATURES = ["hot", "warm", "cold"] as const;
export type LeadTemperatureValue = (typeof LEAD_TEMPERATURES)[number];

/**
 * Next Best Action focus — maps to `RiskLevel` in `insights.ts` (`no_action`
 * ↔ `"none"`; named differently here so an absent `focus` param unambiguously
 * means "no filter", distinct from the "no action needed" bucket itself).
 */
export const LEAD_FOCUS_VALUES = ["needs_attention", "at_risk", "no_action"] as const;
export type LeadFocusValue = (typeof LEAD_FOCUS_VALUES)[number];

export const LEADS_PAGE_SIZE = 20;
/** Absolute ceiling on rows a single list query may return. */
export const LEADS_MAX_PAGE = 500;

const SEARCH_MAX_LENGTH = 80;

export interface LeadListParams {
  search: string;
  /** Sanitised term ready to interpolate into an `ilike` pattern, or "". */
  searchPattern: string;
  temperature: LeadTemperatureValue | null;
  status: LeadStatusValue | null;
  /** Next Best Action risk bucket to narrow to, or `null` for no such filter. */
  focus: LeadFocusValue | null;
  page: number;
  pageSize: number;
  /** Inclusive Postgres range bounds for `.range()`. */
  rangeFrom: number;
  rangeTo: number;
  /** True when any filter/search narrows the list. */
  isFiltered: boolean;
}

function firstValue(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/**
 * Strip anything that could break out of a PostgREST `or(...)` expression or an
 * `ilike` pattern. Keeps letters, digits, spaces and the handful of symbols
 * that legitimately appear in names / emails / phones.
 */
export function sanitizeSearch(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  return s
    .replace(/[^\p{L}\p{N}\s@.+_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_MAX_LENGTH);
}

export function parseLeadListParams(
  raw: Record<string, string | string[] | undefined> = {},
): LeadListParams {
  const search = sanitizeSearch(firstValue(raw.q));

  const tempRaw = firstValue(raw.temp).toLowerCase();
  const temperature = (LEAD_TEMPERATURES as readonly string[]).includes(tempRaw)
    ? (tempRaw as LeadTemperatureValue)
    : null;

  const statusRaw = firstValue(raw.status).toLowerCase();
  const status = (LEAD_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as LeadStatusValue)
    : null;

  const focusRaw = firstValue(raw.focus).toLowerCase();
  const focus = (LEAD_FOCUS_VALUES as readonly string[]).includes(focusRaw)
    ? (focusRaw as LeadFocusValue)
    : null;

  const pageRaw = Number.parseInt(firstValue(raw.page), 10);
  const page =
    Number.isFinite(pageRaw) && pageRaw >= 1
      ? Math.min(pageRaw, LEADS_MAX_PAGE)
      : 1;

  const pageSize = LEADS_PAGE_SIZE;
  const rangeFrom = (page - 1) * pageSize;

  return {
    search,
    searchPattern: search,
    temperature,
    status,
    focus,
    page,
    pageSize,
    rangeFrom,
    rangeTo: rangeFrom + pageSize - 1,
    isFiltered: Boolean(search || temperature || status || focus),
  };
}

/** Rebuild a query string, dropping empties and resetting the page on change. */
export function buildLeadsQuery(
  current: LeadListParams,
  patch: Partial<{
    search: string;
    temperature: string | null;
    status: string | null;
    focus: string | null;
    page: number;
  }>,
): string {
  const next = new URLSearchParams();
  const search = patch.search ?? current.search;
  const temperature =
    patch.temperature !== undefined ? patch.temperature : current.temperature;
  const status = patch.status !== undefined ? patch.status : current.status;
  const focus = patch.focus !== undefined ? patch.focus : current.focus;
  const resetPage =
    patch.search !== undefined ||
    patch.temperature !== undefined ||
    patch.status !== undefined ||
    patch.focus !== undefined;
  const page = resetPage ? 1 : (patch.page ?? current.page);

  if (search) next.set("q", search);
  if (temperature) next.set("temp", temperature);
  if (status) next.set("status", status);
  if (focus) next.set("focus", focus);
  if (page > 1) next.set("page", String(page));

  const qs = next.toString();
  return qs ? `?${qs}` : "";
}

export function totalPages(total: number, pageSize = LEADS_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
