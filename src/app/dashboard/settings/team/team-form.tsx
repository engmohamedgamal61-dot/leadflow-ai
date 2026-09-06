"use client";

import { useActionState, useState } from "react";
import {
  createInviteAction,
  revokeInviteAction,
  type InviteFormState,
} from "@/lib/org/invitation-actions";
import { INVITABLE_ROLES } from "@/lib/org/invitations";
import { useI18n } from "@/i18n/client";

const INITIAL: InviteFormState = {};

export function InviteForm() {
  const { t, tOptional } = useI18n();
  const [state, formAction, pending] = useActionState(createInviteAction, INITIAL);
  const [copied, setCopied] = useState(false);

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-foreground">{t("team.inviteTitle")}</h2>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <input
          type="email"
          name="email"
          required
          placeholder={t("auth.emailPlaceholder")}
          aria-label={t("auth.emailLabel")}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60"
        />
        <select
          name="role"
          aria-label={t("team.roleLabel")}
          defaultValue="viewer"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60"
        >
          {INVITABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {tOptional(`roles.${r}`) ?? r}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:opacity-40"
      >
        {pending ? t("common.saving") : t("team.sendInvite")}
      </button>

      {state.errorCode ? <p className="text-xs text-rose-600">{t(state.errorCode)}</p> : null}

      {state.ok && state.inviteLink ? (
        <div className="space-y-1.5 rounded-lg border border-border bg-background/40 p-3">
          <p className="text-xs text-emerald-600">{t("team.inviteCreated")}</p>
          <p className="text-[11px] text-muted">{t("team.inviteLinkHint")}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 text-[11px] text-foreground">
              {state.inviteLink}
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(state.inviteLink!).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:text-foreground"
            >
              {copied ? t("common.done") : t("team.copyLink")}
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

export function RevokeInviteButton({ invitationId }: { invitationId: string }) {
  const { t } = useI18n();
  const [, formAction, pending] = useActionState(revokeInviteAction, INITIAL);
  return (
    <form action={formAction}>
      <input type="hidden" name="invitationId" value={invitationId} />
      <button
        type="submit"
        disabled={pending}
        className="text-[11px] text-rose-600/80 hover:text-rose-600 disabled:opacity-40"
      >
        {t("team.revoke")}
      </button>
    </form>
  );
}
