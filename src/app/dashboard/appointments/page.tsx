import type { Metadata } from "next";
import Link from "next/link";
import { requireOrganizationContext } from "@/lib/org/context";
import { listAppointments } from "@/lib/leads/queries";
import { Panel } from "@/components/dashboard/panel";
import { EmptyState } from "@/components/dashboard/states";
import { AppointmentIcon } from "@/components/icons";
import { formatDateTime } from "@/lib/leads/format";
import { getI18n } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.appointments };
}

const STATUS_STYLE: Record<string, string> = {
  scheduled: "bg-indigo-500/10 text-indigo-700",
  rescheduled: "bg-sky-500/10 text-sky-700",
  completed: "bg-emerald-500/10 text-emerald-700",
  cancelled: "bg-rose-500/10 text-rose-700",
  no_show: "bg-amber-500/10 text-amber-700",
};

export default async function AppointmentsPage() {
  const { membership } = await requireOrganizationContext();
  const { t, tOptional, locale } = await getI18n();
  const rows = await listAppointments(membership.organizationId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-foreground">
          <AppointmentIcon className="h-6 w-6 shrink-0 text-muted" />
          {t("appointmentsPage.title")}
        </h1>
        <p className="mt-1 text-sm text-muted">{t("appointmentsPage.subtitle")}</p>
      </div>

      <Panel
        icon={AppointmentIcon}
        title={t("appointmentsPage.listTitle")}
        subtitle={t("appointmentsPage.listSubtitle")}
        bodyClassName="p-0"
      >
        {rows.length === 0 ? (
          <div className="p-2">
            <EmptyState
              title={t("dashboard.noAppointmentsTitle")}
              hint={t("dashboard.noAppointmentsHint")}
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/70">
            {rows.map((a) => {
              const past = a.past;
              return (
                <li key={a.id}>
                  <Link
                    href={`/dashboard/leads/${a.leadId}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-background/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {a.leadName ?? t("common.unnamedLead")}
                      </p>
                      <p
                        className={`mt-0.5 text-xs tabular-nums ${past ? "text-muted/70" : "text-muted"}`}
                      >
                        {formatDateTime(a.startsAt, locale)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                        STATUS_STYLE[a.status] ?? "bg-border/50 text-muted"
                      }`}
                    >
                      {tOptional(`appointmentStatuses.${a.status}`) ?? a.status}
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
