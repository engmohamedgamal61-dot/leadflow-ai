import type { Metadata } from "next";
import Link from "next/link";
import { requireOrganizationContext } from "@/lib/org/context";
import { listLeads } from "@/lib/leads/queries";
import {
  parseLeadListParams,
  buildLeadsQuery,
  totalPages,
} from "@/lib/leads/list-params";
import { StatusBadge, TemperatureBadge } from "@/components/dashboard/badges";
import { EmptyState } from "@/components/dashboard/states";
import { formatDate } from "@/lib/leads/format";
import { LeadsFilters } from "./filters";

export const metadata: Metadata = { title: "Leads — LeadFlow AI" };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { membership } = await requireOrganizationContext();
  const params = parseLeadListParams(await searchParams);
  const { rows, total, page, pageSize } = await listLeads(
    membership.organizationId,
    params,
  );

  const pages = totalPages(total, pageSize);
  const from = total === 0 ? 0 : params.rangeFrom + 1;
  const to = Math.min(params.rangeFrom + pageSize, total);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold text-foreground">Leads</h1>
        <p className="text-xs text-muted tabular-nums">
          {total === 0
            ? "No leads"
            : `${from}–${to} of ${total.toLocaleString("en-US")}`}
        </p>
      </div>

      <LeadsFilters
        key={`${params.search}|${params.temperature ?? ""}|${params.status ?? ""}`}
        params={params}
      />

      {rows.length === 0 ? (
        params.isFiltered ? (
          <EmptyState
            title="No leads match your filters"
            hint="Try a different search term or clear the filters."
            action={
              <Link
                href="/dashboard/leads"
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
              >
                Clear filters
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="No leads yet"
            hint="Leads created through your qualification chat will appear here."
          />
        )
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-surface md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  <th className="px-4 py-2.5 font-medium">Intent</th>
                  <th className="px-4 py-2.5 font-medium">Score</th>
                  <th className="px-4 py-2.5 font-medium">Temp</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((lead) => (
                  <tr
                    key={lead.id}
                    className="transition-colors hover:bg-background/40"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/dashboard/leads/${lead.id}`}
                        className="font-medium text-foreground hover:text-accent"
                      >
                        {lead.name ?? "Unnamed lead"}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted">
                      {lead.phone ?? lead.email ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted">{lead.intent ?? "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums text-foreground">
                      {lead.score}
                    </td>
                    <td className="px-4 py-2.5">
                      <TemperatureBadge value={lead.temperature} />
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge value={lead.status} />
                    </td>
                    <td className="px-4 py-2.5 text-muted">
                      {lead.source ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted">
                      {formatDate(lead.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-2 md:hidden">
            {rows.map((lead) => (
              <li key={lead.id}>
                <Link
                  href={`/dashboard/leads/${lead.id}`}
                  className="block rounded-xl border border-border bg-surface p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-medium text-foreground">
                      {lead.name ?? "Unnamed lead"}
                    </p>
                    <span className="shrink-0 text-xs tabular-nums text-muted">
                      {lead.score}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {lead.intent ?? "—"} · {lead.phone ?? lead.email ?? "—"}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <TemperatureBadge value={lead.temperature} />
                    <StatusBadge value={lead.status} />
                    <span className="text-[11px] text-muted">
                      {formatDate(lead.createdAt)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {pages > 1 ? (
            <nav className="flex items-center justify-between pt-1 text-xs">
              {page > 1 ? (
                <Link
                  href={`/dashboard/leads${buildLeadsQuery(params, { page: page - 1 })}`}
                  className="rounded-lg border border-border px-3 py-1.5 text-muted hover:text-foreground"
                >
                  ← Previous
                </Link>
              ) : (
                <span className="rounded-lg border border-border/50 px-3 py-1.5 text-muted/40">
                  ← Previous
                </span>
              )}
              <span className="text-muted tabular-nums">
                Page {page} of {pages}
              </span>
              {page < pages ? (
                <Link
                  href={`/dashboard/leads${buildLeadsQuery(params, { page: page + 1 })}`}
                  className="rounded-lg border border-border px-3 py-1.5 text-muted hover:text-foreground"
                >
                  Next →
                </Link>
              ) : (
                <span className="rounded-lg border border-border/50 px-3 py-1.5 text-muted/40">
                  Next →
                </span>
              )}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
