"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { useI18n } from "@/i18n/client";
import { describeEventKey, resolveTimelineEntry } from "@/lib/leads/lead-view";
import { formatDate, relativeTimeBucket } from "@/lib/leads/format";
import type { ActivityEvent } from "@/lib/leads/queries";
import {
  AppointmentIcon,
  ChatIcon,
  FollowUpIcon,
  HandoffIcon,
  OpportunityIcon,
  QualifyIcon,
  RecoveryIcon,
  SourceIcon,
  type IconProps,
} from "@/components/icons";
import { brandIcon } from "@/components/icons/brands";

/** A recognised communication channel/brand slug carried in event metadata. */
const KNOWN_CHANNEL_BRANDS: Record<string, string> = { whatsapp: "whatsapp" };

/**
 * When an event's metadata names a real channel (today only `follow_up_executed`
 * records one), show that channel's brand mark instead of the semantic icon.
 */
function brandFor(
  eventType: string,
  metadata: unknown,
): ComponentType<IconProps> | null {
  if (eventType !== "follow_up_executed") return null;
  const channel =
    metadata && typeof metadata === "object" && "channel" in metadata
      ? (metadata as { channel?: unknown }).channel
      : null;
  if (typeof channel !== "string") return null;
  return brandIcon(KNOWN_CHANNEL_BRANDS[channel] ?? null);
}

/** eventType → a small semantic icon chip (tone carries meaning, not decoration). */
function iconFor(eventType: string): { icon: ComponentType<IconProps>; chip: string } {
  if (eventType === "lead_created")
    return { icon: SourceIcon, chip: "bg-sky-500/10 text-sky-600" };
  if (eventType === "lead_qualified" || eventType === "mark_qualified")
    return { icon: QualifyIcon, chip: "bg-emerald-500/10 text-emerald-600" };
  if (eventType.startsWith("appointment_"))
    return { icon: AppointmentIcon, chip: "bg-indigo-500/10 text-indigo-600" };
  if (eventType.startsWith("follow_up_"))
    return { icon: FollowUpIcon, chip: "bg-amber-500/10 text-amber-600" };
  if (eventType === "human_handoff_requested")
    return { icon: HandoffIcon, chip: "bg-rose-500/10 text-rose-600" };
  if (eventType.startsWith("recovery_"))
    return { icon: RecoveryIcon, chip: "bg-amber-500/10 text-amber-600" };
  if (eventType === "message_received")
    return { icon: ChatIcon, chip: "bg-sky-500/10 text-sky-600" };
  return { icon: OpportunityIcon, chip: "bg-border/60 text-muted" };
}

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

export function ActivityFeed({
  events,
  max,
}: {
  events: ActivityEvent[];
  max?: number;
}) {
  const { t, tOptional, locale } = useI18n();
  const rows = max ? events.slice(0, max) : events;

  return (
    <ul className="divide-y divide-border/70">
      {rows.map((e) => {
        const entry = resolveTimelineEntry(
          describeEventKey({
            event_type: e.eventType,
            metadata: e.metadata,
            created_at: e.createdAt,
          }),
          { t, tOptional, locale },
        );
        const semantic = iconFor(e.eventType);
        const Brand = brandFor(e.eventType, e.metadata);
        const Icon = Brand ?? semantic.icon;
        const chip = Brand ? "border border-border bg-surface" : semantic.chip;
        const context = [e.leadName ?? t("common.unnamedLead"), entry.detail]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={e.id}>
            <Link
              href={`/dashboard/leads/${e.leadId}`}
              className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-background"
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${chip}`}
              >
                <Icon className={Brand ? "h-[17px] w-[17px]" : "h-4 w-4"} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-foreground">
                  {entry.title}
                </p>
                <p className="truncate text-[11.5px] text-muted">{context}</p>
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
