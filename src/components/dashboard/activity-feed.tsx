"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/client";
import { describeEventKey, resolveTimelineEntry } from "@/lib/leads/lead-view";
import { formatDate, relativeTimeBucket } from "@/lib/leads/format";
import type { ActivityEvent } from "@/lib/leads/queries";

function RelativeTime({ iso }: { iso: string }) {
  const { t, locale } = useI18n();
  const bucket = relativeTimeBucket(iso);
  switch (bucket.unit) {
    case "now":
      return <>{t("common.time.justNow")}</>;
    case "minutes":
      return <>{t("common.time.minutesAgo", { count: bucket.value })}</>;
    case "hours":
      return <>{t("common.time.hoursAgo", { count: bucket.value })}</>;
    case "days":
      return <>{t("common.time.daysAgo", { count: bucket.value })}</>;
    default:
      return <>{formatDate(iso, locale)}</>;
  }
}

export function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  const { t, tOptional, locale } = useI18n();

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
      {events.map((e) => {
        const entry = resolveTimelineEntry(
          describeEventKey({ event_type: e.eventType, metadata: e.metadata, created_at: e.createdAt }),
          { t, tOptional, locale },
        );
        return (
          <li key={e.id}>
            <Link
              href={`/dashboard/leads/${e.leadId}`}
              className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-background/40"
            >
              <div className="min-w-0">
                <p className="text-sm text-foreground">
                  <span className="font-medium">{entry.title}</span>
                  <span className="text-muted"> · {e.leadName ?? t("common.unnamedLead")}</span>
                </p>
                {entry.detail ? (
                  <p className="mt-0.5 truncate text-xs text-muted">{entry.detail}</p>
                ) : null}
              </div>
              <span className="shrink-0 whitespace-nowrap text-[11px] text-muted">
                <RelativeTime iso={e.createdAt} />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
