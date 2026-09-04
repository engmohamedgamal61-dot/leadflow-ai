import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrganizationContext, canWriteLeads } from "@/lib/org/context";
import { getEffectiveConfig, enabledLeadFields } from "@/lib/config";
import { getLeadDetail } from "@/lib/leads/queries";
import { buildLeadFieldViews, describeEvent } from "@/lib/leads/lead-view";
import { formatDate, formatDateTime } from "@/lib/leads/format";
import { StatusBadge, TemperatureBadge } from "@/components/dashboard/badges";
import { StatusForm } from "./status-form";

export const metadata: Metadata = { title: "Lead — LeadFlow AI" };

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { membership } = await requireOrganizationContext();

  const detail = await getLeadDetail(membership.organizationId, id);
  if (!detail) notFound();

  const { record, conversations, messages, events } = detail;
  const config = getEffectiveConfig({
    organizationId: membership.organizationId,
    industryTemplateId: membership.industryTemplateId,
  });
  const fieldViews = buildLeadFieldViews(record.lead, enabledLeadFields(config));
  const canEdit = canWriteLeads(membership.role);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/leads"
          className="text-xs text-muted hover:text-foreground"
        >
          ← All leads
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-foreground">
            {record.lead.name ?? "Unnamed lead"}
          </h1>
          <TemperatureBadge value={record.temperature} />
          <StatusBadge value={record.status} />
          <span className="text-sm text-muted tabular-nums">
            Score {record.score}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Lead data — generic renderer (core + template + extra custom_data) */}
          <section className="rounded-xl border border-border bg-surface">
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
              Lead data
            </h2>
            <dl className="divide-y divide-border/60">
              {fieldViews.map((f) => (
                <div
                  key={`${f.source}:${f.key}`}
                  className="flex items-start justify-between gap-4 px-4 py-2.5"
                >
                  <dt className="text-xs text-muted">{f.label}</dt>
                  <dd
                    className={`max-w-[60%] break-words text-right text-sm ${
                      f.value === null ? "text-muted/50" : "text-foreground"
                    }`}
                  >
                    {f.display}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Conversation(s) */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">
              Conversation{conversations.length > 1 ? "s" : ""}
            </h2>
            {conversations.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-surface/50 px-4 py-8 text-center text-xs text-muted">
                No persisted conversation for this lead.
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
                      <span className="capitalize">
                        {conv.channel} · {conv.status}
                      </span>
                      <span>{formatDateTime(conv.startedAt)}</span>
                    </div>
                    <div className="space-y-3 px-4 py-4">
                      {convMessages.length === 0 ? (
                        <p className="text-xs text-muted">No messages.</p>
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
                              {m.role === "assistant" ? "Assistant" : m.role}
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
            <h2 className="text-sm font-semibold text-foreground">Timeline</h2>
            {events.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-surface/50 px-4 py-8 text-center text-xs text-muted">
                No events recorded.
              </p>
            ) : (
              <ol className="space-y-2">
                {events.map((e, i) => {
                  const entry = describeEvent({
                    event_type: e.eventType,
                    metadata: e.metadata,
                    created_at: e.createdAt,
                  });
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
                            {formatDateTime(entry.at)}
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
            <h2 className="text-sm font-semibold text-foreground">Status</h2>
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
                  Your role is read-only for leads.
                </p>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-surface p-4">
            <dl className="space-y-2.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted">Score</dt>
                <dd className="tabular-nums text-foreground">{record.score}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Temperature</dt>
                <dd>
                  <TemperatureBadge value={record.temperature} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Source</dt>
                <dd className="text-foreground">{record.source ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Created</dt>
                <dd className="text-foreground">
                  {formatDate(record.createdAt)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Updated</dt>
                <dd className="text-foreground">
                  {formatDateTime(record.updatedAt)}
                </dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}
