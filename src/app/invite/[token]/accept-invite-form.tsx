"use client";

import { useActionState } from "react";
import { acceptInviteAction, type AcceptInviteState } from "@/lib/org/invitation-actions";
import { SubmitButton, FormFeedback } from "@/components/auth/form-feedback";
import { useI18n } from "@/i18n/client";

const INITIAL: AcceptInviteState = {};

export function AcceptInviteForm({ token }: { token: string }) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(acceptInviteAction, INITIAL);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <FormFeedback error={state.errorCode ? t(state.errorCode) : undefined} />
      <SubmitButton pending={pending} pendingLabel={t("invite.accepting")}>
        {t("invite.accept")}
      </SubmitButton>
    </form>
  );
}
