import type { Metadata } from "next";
import { requireOrganizationContext } from "@/lib/org/context";
import { getRecentActivity } from "@/lib/leads/queries";
import { Panel } from "@/components/dashboard/panel";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { EmptyState } from "@/components/dashboard/states";
import { ActivityIcon } from "@/components/icons";
import { getI18n } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.activity };
}

export default async function ActivityPage() {
  const { membership } = await requireOrganizationContext();
  const { t } = await getI18n();
  const events = await getRecentActivity(membership.organizationId, 20);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-foreground">
          <ActivityIcon className="h-6 w-6 shrink-0 text-muted" />
          {t("activity.title")}
        </h1>
        <p className="mt-1 text-sm text-muted">{t("activity.subtitle")}</p>
      </div>

      <Panel
        icon={ActivityIcon}
        tone="sky"
        title={t("dashboard.activity.title")}
        subtitle={t("dashboard.activity.subtitle")}
        bodyClassName="p-0"
      >
        {events.length === 0 ? (
          <div className="p-2">
            <EmptyState
              title={t("dashboard.activity.emptyTitle")}
              hint={t("dashboard.activity.emptyHint")}
            />
          </div>
        ) : (
          <ActivityFeed events={events} />
        )}
      </Panel>
    </div>
  );
}
