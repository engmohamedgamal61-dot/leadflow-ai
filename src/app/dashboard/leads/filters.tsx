"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  LEAD_STATUSES,
  LEAD_TEMPERATURES,
  buildLeadsQuery,
  type LeadListParams,
} from "@/lib/leads/list-params";
import { useI18n } from "@/i18n/client";
import { humanizeKey } from "@/lib/leads/lead-view";

/**
 * Remounted by the parent (via `key`) on every URL change, so `useState`
 * always initialises from the current `params` — no prop→state sync effect.
 */
export function LeadsFilters({ params }: { params: LeadListParams }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t, tOptional } = useI18n();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(params.search);
  const firstRender = useRef(true);

  const navigate = (qs: string) => {
    startTransition(() => router.push(`${pathname}${qs}`));
  };

  // Debounced search → URL.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const id = setTimeout(() => {
      if (search === params.search) return;
      navigate(buildLeadsQuery(params, { search }));
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("leads.searchPlaceholder")}
          aria-label={t("leads.searchLabel")}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted/60 outline-none focus:border-accent/60"
        />
        {pending ? (
          <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[11px] text-muted">
            …
          </span>
        ) : null}
      </div>

      <select
        value={params.temperature ?? ""}
        aria-label={t("leads.filterTemperature")}
        onChange={(e) =>
          navigate(
            buildLeadsQuery(params, { temperature: e.target.value || null }),
          )
        }
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60"
      >
        <option value="">{t("leads.allTemperatures")}</option>
        {LEAD_TEMPERATURES.map((temp) => (
          <option key={temp} value={temp}>
            {tOptional(`temperatures.${temp}`) ?? temp.toUpperCase()}
          </option>
        ))}
      </select>

      <select
        value={params.status ?? ""}
        aria-label={t("leads.filterStatus")}
        onChange={(e) =>
          navigate(buildLeadsQuery(params, { status: e.target.value || null }))
        }
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60"
      >
        <option value="">{t("leads.allStatuses")}</option>
        {LEAD_STATUSES.map((status) => (
          <option key={status} value={status}>
            {tOptional(`statuses.${status}`) ?? humanizeKey(status)}
          </option>
        ))}
      </select>

      {params.isFiltered ? (
        <button
          type="button"
          onClick={() => navigate("")}
          className="rounded-lg border border-border px-3 py-2 text-xs text-muted hover:text-foreground"
        >
          {t("common.clear")}
        </button>
      ) : null}
    </div>
  );
}
