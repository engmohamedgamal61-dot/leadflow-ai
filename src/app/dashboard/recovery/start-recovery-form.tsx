"use client";

import { useActionState } from "react";
import { startRecoveryAction, type RecoveryFormState } from "@/lib/leads/recovery-actions";
import { useI18n } from "@/i18n/client";

const INITIAL: RecoveryFormState = {};

export function StartRecoveryForm({ leadId }: { leadId: string }) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(startRecoveryAction, INITIAL);

  if (state.ok) {
    return <p className="text-xs text-emerald-600">{t("recovery.started")}</p>;
  }

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="leadId" value={leadId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:opacity-40"
      >
        {pending ? t("common.saving") : t("recovery.startButton")}
      </button>
      {state.errorCode ? <p className="text-[11px] text-rose-600">{t(state.errorCode)}</p> : null}
    </form>
  );
}
