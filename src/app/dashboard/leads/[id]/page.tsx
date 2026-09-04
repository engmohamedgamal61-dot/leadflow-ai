import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrganizationContext, canWriteLeads } from "@/lib/org/context";
import { enabledLeadFields } from "@/lib/config";
import { loadEffectiveConfig } from "@/lib/config/organization-config.server";
import { getLeadDetail } from "@/lib/leads/queries";
import {
  buildLeadFieldViews,
  describeEventKey,
  localizeFieldView,
  resolveTimelineEntry,
} from "@/lib/leads/lead-view";
import { formatDate, formatDateTime } from "@/lib/leads/format";
import { isQualificationComplete } from "@/lib/agent/qualification";
import { StatusBadge, TemperatureBadge } from "@/components/dashboard/badges";
import { getI18n } from "@/i18n/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAvailability } from "@/lib/calendar/service";
import { getConnectionView } from "@/lib/calendar/connections";
import { StatusForm } from "./status-form";
import {
  AddFollowUpForm,
  FollowUpItem,
  HandoffButton,
  MarkQualifiedButton,
} from "./agent-actions";
import { AppointmentItem, BookAppointmentForm } from "./appointment-actions";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.lead };
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { membership } = await requireOrganizationContext();
  const { t, tOptional, locale } = await getI18n();

  const detail = await getLeadDetail(membership.organizationId, id);
  if (!detail) notFound();

  const { record, conversations, messages, events, followUps, appointments, needsAttention } =
    detail;
  const config = await loadEffectiveConfig(
    membership.organizationId,
    membership.industryTemplateId,
  );

  // Reading real availability needs the decrypted calendar tokens, which are
  // revoked from `authenticated` at the database level — same trusted-server
  // boundary as the AI chat path (see `getAvailabilityForPrompt`).
  const adminDb = createAdminClient();
  const [calendarConnection, availableSlotsRaw] = await Promise.all([
    getConnectionView(adminDb, membership.organizationId),
    getAvailability(adminDb, membership.organizationId),
  ]);
  const calendarConnected = calendarConnection?.status === "connected";
  const availableSlots = availableSlotsRaw ?? [];
  const fieldViews = buildLeadFieldViews(
    record.lead,
    enabledLeadFields(config),
  ).map((view) => ({
    key: `${view.source}:${view.key}`,
    ...localizeFieldView(view, { t, tOptional, locale }),
    isEmpty: view.value === null || view.value === undefined || view.value === "",
  }));
  const canEdit = canWriteLeads(membership.role);

  const pendingFollowUps = followUps.filter((f) => f.status === "pending");
  const pastFollowUps = followUps.filter((f) => f.status !== "pending");
  const qualComplete = isQualificationComplete(record.lead, config);
  const alreadyQualified = ["qualified", "appointment", "won"].includes(
    record.status,
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/leads"
          className="text-xs text-muted hover:text-foreground"
        >
          {t("leadDetail.allLeads")}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-foreground">
            {record.lead.name ?? t("common.unnamedLead")}
          </h1>
          <TemperatureBadge value={record.temperature} />
          <StatusBadge value={record.status} />
          <span className="text-sm text-muted tabular-nums">
            {t("leadDetail.scoreWithValue", { score: record.score })}
          </span>
        </div>
      </div>

      {needsAttention ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span className="font-medium">{t("leadDetail.needsAttentionBadge")}</span>{" "}
          {t("leadDetail.needsAttentionText")}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Lead data — generic renderer (core + template + extra custom_data) */}
          <section className="rounded-xl border border-border bg-surface">
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
              {t("leadDetail.sections.leadData")}
            </h2>
            <dl className="divide-y divide-border/60">
              {fieldViews.map((f) => (
                <div
                  key={f.key}
                  className="flex items-start justify-between gap-4 px-4 py-2.5"
                >
                  <dt className="text-xs text-muted">{f.label}</dt>
                  <dd
                    className={`max-w-[60%] break-words text-end text-sm ${
                      f.isEmpty ? "text-muted/50" : "text-foreground"
                    }`}
                  >
                    {f.display}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Follow-ups */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">
              {t("leadDetail.sections.followUps")}
              {pendingFollowUps.length > 0 ? (
                <span className="ms-2 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                  {t("leadDetail.followUps.pendingBadge", {
                    count: pendingFollowUps.length,
                  })}
                </span>
              ) : null}
            </h2>
            {followUps.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-surface/50 px-4 py-6 text-center text-xs text-muted">
                {t("leadDetail.followUps.none")}
              </p>
            ) : (
              <ul className="space-y-2">
                {pendingFollowUps.map((f) => (
                  <FollowUpItem key={f.id} followUp={f} canWrite={canEdit} />
                ))}
                {pastFollowUps.map((f) => (
                  <FollowUpItem key={f.id} followUp={f} canWrite={canEdit} />
                ))}
              </ul>
            )}
          </section>

          {/* Appointments */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">
              {t("leadDetail.sections.appointments")}
            </h2>
            {appointments.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-surface/50 px-4 py-6 text-center text-xs text-muted">
                {t("leadDetail.appointments.none")}
              </p>
            ) : (
              <ul className="space-y-2">
                {appointments.map((a) => (
                  <AppointmentItem
                    key={a.id}
                    appointment={a}
                    canWrite={canEdit}
                    availableSlots={availableSlots}
                  />
                ))}
              </ul>
            )}
            {canEdit ? (
              <BookAppointmentForm
                leadId={record.id}
                availableSlots={availableSlots}
                calendarConnected={calendarConnected}
              />
            ) : null}
          </section>

          {/* Conversation(s) */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">
              {conversations.length > 1
                ? t("leadDetail.sections.conversations")
                : t("leadDetail.sections.conversation")}
            </h2>
            {conversations.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-surface/50 px-4 py-8 text-center text-xs text-muted">
                {t("leadDetail.conversation.none")}
              </p>
            ) : (
              conversations.map((conv) => {
                const convMessages = messages.filter(
                  (m) => m.conversationId === conv.id,
                );
                return (
                  <div
                    key={conv.id}
                    className="overflow-hidden rounded-xl border border-border bg-surface"
                  >
                    <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs text-muted">
                      <span>
                        {t("leadDetail.conversation.channelStatus", {
                          channel: conv.channel,
                          status: conv.status,
                        })}
                      </span>
                      <span>{formatDateTime(conv.startedAt, locale)}</span>
                    </div>
                    <div className="space-y-3 px-4 py-4">
                      {convMessages.length === 0 ? (
                        <p className="text-xs text-muted">
                          {t("leadDetail.conversation.noMessages")}
                        </p>
                      ) : (
                        convMessages.map((m, i) => (
                          <div
                            key={`${conv.id}-${i}`}
                            className={
                              m.role === "assistant"
                                ? ""
                                : "flex flex-col items-end"
                            }
                          >
                            <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted">
                              {m.role === "assistant"
                                ? t("leadDetail.conversation.assistant")
                                : t("leadDetail.conversation.you")}
                            </p>
                            <p
                              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                                m.role === "assistant"
                                  ? "bg-background text-foreground"
                                  : "bg-accent text-accent-foreground"
                              }`}
                            >
                              {m.content}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </section>

          {/* Timeline */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">
              {t("leadDetail.sections.timeline")}
            </h2>
            {events.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-surface/50 px-4 py-8 text-center text-xs text-muted">
                {t("leadDetail.timeline.none")}
              </p>
            ) : (
              <ol className="space-y-2">
                {events.map((e, i) => {
                  const entry = resolveTimelineEntry(
                    describeEventKey({
                      event_type: e.eventType,
                      metadata: e.metadata,
                      created_at: e.createdAt,
                    }),
                    { t, tOptional, locale },
                  );
                  return (
                    <li
                      key={i}
                      className="flex gap-3 rounded-lg border border-border bg-surface px-3 py-2"
                    >
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-xs font-medium text-foreground">
                            {entry.title}
                          </p>
                          <p className="shrink-0 text-[10px] text-muted">
                            {formatDateTime(entry.at, locale)}
                          </p>
                        </div>
                        {entry.detail ? (
                          <p className="mt-0.5 truncate text-xs text-muted">
                            {entry.detail}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold text-foreground">
              {t("leadDetail.sections.status")}
            </h2>
            {canEdit ? (
              <StatusForm
                key={record.status}
                leadId={record.id}
                current={record.status}
              />
            ) : (
              <div className="mt-3">
                <StatusBadge value={record.status} />
                <p className="mt-2 text-xs text-muted">
                  {t("leadDetail.status.readonly")}
                </p>
              </div>
            )}
          </section>

          {canEdit ? (
            <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
              <h2 className="text-sm font-semibold text-foreground">
                {t("leadDetail.sections.agentActions")}
              </h2>
              {!alreadyQualified ? (
                <div>
                  <MarkQualifiedButton leadId={record.id} />
                  <p className="mt-1 text-[11px] text-muted/70">
                    {qualComplete
                      ? t("leadDetail.agentActions.qualComplete")
                      : t("leadDetail.agentActions.qualIncomplete")}
                  </p>
                </div>
              ) : null}
              <AddFollowUpForm leadId={record.id} />
              <HandoffButton leadId={record.id} />
            </section>
          ) : null}

          <section className="rounded-xl border border-border bg-surface p-4">
            <dl className="space-y-2.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted">{t("leadDetail.sidebar.score")}</dt>
                <dd className="tabular-nums text-foreground">{record.score}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{t("leadDetail.sidebar.temperature")}</dt>
                <dd>
                  <TemperatureBadge value={record.temperature} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{t("leadDetail.sidebar.source")}</dt>
                <dd className="text-foreground">{record.source ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{t("leadDetail.sidebar.created")}</dt>
                <dd className="text-foreground">
                  {formatDate(record.createdAt, locale)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">{t("leadDetail.sidebar.updated")}</dt>
                <dd className="text-foreground">
                  {formatDateTime(record.updatedAt, locale)}
                </dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
