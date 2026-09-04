import type { Metadata } from "next";
import Link from "next/link";
import { requireOrganizationContext } from "@/lib/org/context";
import { getIndustryTemplate } from "@/lib/config";
import { getLeadStats, getRecentLeads } from "@/lib/leads/queries";
import { StatCard } from "@/components/dashboard/stat-card";
import { StatusBadge, TemperatureBadge } from "@/components/dashboard/badges";
import { EmptyState } from "@/components/dashboard/states";
import { formatDate } from "@/lib/leads/format";

export const metadata: Metadata = { title: "Overview — LeadFlow AI" };

export default async function DashboardOverviewPage() {
  const { membership } = await requireOrganizationContext();
  const template = getIndustryTemplate(membership.industryTemplateId);

  const [stats, recent] = await Promise.all([
    getLeadStats(membership.organizationId),
    getRecentLeads(membership.organizationId, 6),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          Overview
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">
          {membership.organizationName}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {template?.name ?? membership.industryTemplateId} workspace
        </p>
      </div>

      <section aria-label="Lead statistics">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Total leads" value={stats.total} />
          <StatCard label="Hot" value={stats.hot} accent="hot" />
          <StatCard label="Warm" value={stats.warm} accent="warm" />
          <StatCard label="Cold" value={stats.cold} accent="cold" />
          <StatCard label="Qualified" value={stats.qualified} />
          <StatCard
            label="Conversion"
            value={
              stats.total > 0
                ? `${Math.round((stats.qualified / stats.total) * 100)}%`
                : "—"
            }
          />
        </div>
      </section>

      <section aria-label="Recent leads" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Recent leads</h2>
          <Link
            href="/dashboard/leads"
            className="text-xs text-muted hover:text-foreground"
          >
            View all →
          </Link>
        </div>

        {recent.length === 0 ? (
          <EmptyState
            title="No leads yet"
            hint="Leads created through your qualification chat will appear here."
            action={
              <Link
                href="/"
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90"
              >
                Open the chat
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {recent.map((lead) => (
              <li key={lead.id}>
                <Link
                  href={`/dashboard/leads/${lead.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-background/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {lead.name ?? "Unnamed lead"}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {lead.intent ?? "—"} ·{" "}
                      {lead.phone ?? lead.email ?? "no contact"} ·{" "}
                      {formatDate(lead.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs tabular-nums text-muted">
                      {lead.score}
                    </span>
                    <TemperatureBadge value={lead.temperature} />
                    <StatusBadge value={lead.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
