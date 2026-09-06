import type { Metadata } from "next";
import { requireOrganizationContext, canManageConfig } from "@/lib/org/context";
import { createClient } from "@/lib/supabase/server";
import { listOrgMembers } from "@/lib/org/members.server";
import { listInvitations } from "@/lib/org/invitations.server";
import { TeamIcon } from "@/components/icons";
import { formatDate } from "@/lib/leads/format";
import { getI18n } from "@/i18n/server";
import { InviteForm, RevokeInviteButton } from "./team-form";

export async function generateMetadata(): Promise<Metadata> {
  const { dict } = await getI18n();
  return { title: dict.meta.team };
}

export default async function TeamPage() {
  const { user, membership } = await requireOrganizationContext();
  const { t, tOptional, locale } = await getI18n();
  const canManage = canManageConfig(membership.role);

  const members = await listOrgMembers(membership.organizationId, user.id);
  const db = await createClient();
  const invitations = canManage
    ? await listInvitations(db, membership.organizationId)
    : [];
  const pending = invitations.filter((i) => i.status === "pending");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-foreground">
          <TeamIcon className="h-6 w-6 shrink-0 text-muted" />
          {t("team.title")}
        </h1>
        <p className="mt-1 text-sm text-muted">{t("team.subtitle")}</p>
        {!canManage ? (
          <p className="mt-2 inline-block rounded-md border border-border bg-background px-2 py-1 text-xs text-muted">
            {t("team.readonly")}
          </p>
        ) : null}
      </div>

      {canManage ? <InviteForm /> : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">{t("team.membersTitle")}</h2>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {m.email ?? m.userId}
                  {m.isYou ? <span className="ms-2 text-xs text-muted">{t("team.you")}</span> : null}
                </p>
                <p className="text-xs text-muted">
                  {t("team.joined", { date: formatDate(m.joinedAt, locale) })}
                </p>
              </div>
              <span className="shrink-0 rounded-md bg-border/50 px-2 py-0.5 text-[11px] font-medium text-foreground">
                {tOptional(`roles.${m.role}`) ?? m.role}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {canManage && pending.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">{t("team.pendingTitle")}</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {pending.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{i.email}</p>
                  <p className="text-xs text-muted">
                    {(tOptional(`roles.${i.role}`) ?? i.role)} ·{" "}
                    {t("team.expires", { date: formatDate(i.expiresAt, locale) })}
                  </p>
                </div>
                <RevokeInviteButton invitationId={i.id} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
