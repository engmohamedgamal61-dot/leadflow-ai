import type { Metadata } from "next";
import Link from "next/link";
import { requireOrganizationContext, canWriteLeads } from "@/lib/org/context";
import {
  getRecoveryCandidates,
  getRecoverySummary,
  listRecoveryAttempts,
} from "@/lib/leads/queries";
import { StatCard } from "@/components/dashboard/stat-card";
import { PriorityBadge, OutcomeBadge } from "@/components/dashboard/badges";
import { EmptyState } from "@/components/dashboard/states";
import { formatDate } from "@/lib/leads/format";
import { getI18n } from "@/i18n/server";
import { StartRecoveryForm } from "./start-recovery-form";

const CANDIDATES_LIMIT = 50;
const RECENT_ATTEMPTS_LIMIT = 10;

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.recovery };
}

export default async function RecoveryPage() {
  const { membership } = await requireOrganizationContext();
  const { t, locale } = await getI18n();
  const canWrite = canWriteLeads(membership.role);

  const [candidates, summary, attempts] = await Promise.all([
    getRecoveryCandidates(membership.organizationId),
    getRecoverySummary(membership.organizationId),
    listRecoveryAttempts(membership.organizationId),
  ]);

  const visibleCandidates = candidates.slice(0, CANDIDATES_LIMIT);
  const recentAttempts = attempts.slice(0, RECENT_ATTEMPTS_LIMIT);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t("recovery.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("recovery.subtitle")}</p>
      </div>

      <section aria-label={t("recovery.ariaResults")} className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">{t("recovery.resultsTitle")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label={t("recovery.outcomes.pending")} value={summary.pending} />
          <StatCard label={t("recovery.outcomes.contacted")} value={summary.contacted} />
          <StatCard
            label={t("recovery.outcomes.recovered")}
            value={summary.recovered}
            accent={summary.recovered > 0 ? "warm" : "default"}
          />
          <StatCard
            label={t("recovery.outcomes.converted")}
            value={summary.converted}
            accent={summary.converted > 0 ? "cold" : "default"}
          />
          <StatCard
            label={t("recovery.outcomes.no_response")}
            value={summary.noResponse}
            accent={summary.noResponse > 0 ? "hot" : "default"}
          />
        </div>
      </section>

      <section aria-label={t("recovery.ariaOpportunities")} className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          {t("recovery.opportunitiesTitle")}
        </h2>
        {visibleCandidates.length === 0 ? (
          <EmptyState
            title={t("recovery.noOpportunitiesTitle")}
            hint={t("recovery.noOpportunitiesHint")}
          />
        ) : (
          <ul className="space-y-2">
            {visibleCandidates.map(({ lead, candidate }) => (
              <li
                key={lead.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface p-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/leads/${lead.id}`}
                    className="text-sm font-medium text-foreground hover:text-accent"
                  >
                    {lead.name ?? t("common.unnamedLead")}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <PriorityBadge value={candidate.priority} />
                  </div>
                  <p className="mt-1 max-w-md text-xs text-muted">
                    {t(candidate.reasonKey, candidate.reasonParams)}
                  </p>
                </div>
                {canWrite ? <StartRecoveryForm leadId={lead.id} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t("recovery.ariaAttempts")} className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          {t("recovery.recentAttemptsTitle")}
        </h2>
        {recentAttempts.length === 0 ? (
          <EmptyState
            title={t("recovery.noAttemptsTitle")}
            hint={t("recovery.noAttemptsHint")}
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {recentAttempts.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/dashboard/leads/${a.leadId}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-background/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {a.leadName ?? t("common.unnamedLead")}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                      <PriorityBadge value={a.priority} />
                      <span>{formatDate(a.createdAt, locale)}</span>
                    </p>
                  </div>
                  <OutcomeBadge value={a.outcome} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
