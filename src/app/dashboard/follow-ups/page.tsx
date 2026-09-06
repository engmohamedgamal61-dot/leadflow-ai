import type { Metadata } from "next";
import Link from "next/link";
import { requireOrganizationContext } from "@/lib/org/context";
import { listOpenFollowUps } from "@/lib/leads/queries";
import { Panel } from "@/components/dashboard/panel";
import { EmptyState } from "@/components/dashboard/states";
import { FollowUpIcon } from "@/components/icons";
import { formatDateTime } from "@/lib/leads/format";
import { getI18n } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.followUps };
}

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-700",
  processing: "bg-sky-500/10 text-sky-700",
  failed: "bg-rose-500/10 text-rose-700",
};

export default async function FollowUpsPage() {
  const { membership } = await requireOrganizationContext();
  const { t, tOptional, locale } = await getI18n();
  const rows = await listOpenFollowUps(membership.organizationId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-foreground">
          <FollowUpIcon className="h-6 w-6 shrink-0 text-muted" />
          {t("followUpsPage.title")}
        </h1>
        <p className="mt-1 text-sm text-muted">{t("followUpsPage.subtitle")}</p>
      </div>

      <Panel
        icon={FollowUpIcon}
        tone="amber"
        title={t("followUpsPage.listTitle")}
        subtitle={t("followUpsPage.listSubtitle")}
        bodyClassName="p-0"
      >
        {rows.length === 0 ? (
          <div className="p-2">
            <EmptyState
              title={t("followUpsPage.emptyTitle")}
              hint={t("followUpsPage.emptyHint")}
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {rows.map((f) => {
              const overdue = f.overdue;
              return (
                <li key={f.id}>
                  <Link
                    href={`/dashboard/leads/${f.leadId}`}
                    className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-background/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {f.leadName ?? t("common.unnamedLead")}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        <span
                          className={overdue ? "text-amber-700" : undefined}
                        >
                          {overdue
                            ? t("followUpsPage.overdue", {
                                date: formatDateTime(f.scheduledAt, locale),
                              })
                            : formatDateTime(f.scheduledAt, locale)}
                        </span>
                        {f.channel ? ` · ${f.channel}` : ""}
                      </p>
                      {f.lastError ? (
                        <p className="mt-0.5 truncate text-xs text-rose-600/90">
                          {f.lastError}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                        STATUS_STYLE[f.status] ?? "bg-border/50 text-muted"
                      }`}
                    >
                      {tOptional(`followUps.status.${f.status}`) ?? f.status}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
