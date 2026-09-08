"use client";

import { useActionState } from "react";
import {
  updateUsageLimitsAction,
  type UsageLimitsFormState,
} from "@/lib/metering/limits-actions";
import { useI18n } from "@/i18n/client";

const INITIAL: UsageLimitsFormState = {};

export interface LimitsFormValues {
  monthlyTokenLimit: number | null;
  monthlyRequestLimit: number | null;
  monthlyCostLimitUsd: number | null;
  warningThresholdPercent: number;
  hardLimitEnabled: boolean;
}

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60 disabled:opacity-60";

export function LimitsForm({
  values,
  canManage,
}: {
  values: LimitsFormValues;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(
    updateUsageLimitsAction,
    INITIAL,
  );
  const disabled = !canManage || pending;

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted">
            {t("settingsUsage.limitsForm.tokenLimit")}
          </span>
          <input
            type="number"
            name="tokenLimit"
            min={0}
            step={1000}
            inputMode="numeric"
            defaultValue={values.monthlyTokenLimit ?? ""}
            placeholder={t("settingsUsage.limitsForm.noLimitPlaceholder")}
            disabled={disabled}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted">
            {t("settingsUsage.limitsForm.requestLimit")}
          </span>
          <input
            type="number"
            name="requestLimit"
            min={0}
            step={1}
            inputMode="numeric"
            defaultValue={values.monthlyRequestLimit ?? ""}
            placeholder={t("settingsUsage.limitsForm.noLimitPlaceholder")}
            disabled={disabled}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted">
            {t("settingsUsage.limitsForm.costLimit")}
          </span>
          <input
            type="number"
            name="costLimit"
            min={0}
            step="0.01"
            inputMode="decimal"
            defaultValue={values.monthlyCostLimitUsd ?? ""}
            placeholder={t("settingsUsage.limitsForm.noLimitPlaceholder")}
            disabled={disabled}
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted">
            {t("settingsUsage.limitsForm.warningThreshold")}
          </span>
          <input
            type="number"
            name="warningThreshold"
            min={1}
            max={100}
            step={1}
            inputMode="numeric"
            defaultValue={values.warningThresholdPercent}
            disabled={disabled}
            className={inputClass}
          />
          <span className="block text-[11px] text-muted/70">
            {t("settingsUsage.limitsForm.warningThresholdHint")}
          </span>
        </label>

        <label className="flex items-start gap-2.5 sm:col-span-2">
          <input
            type="checkbox"
            name="hardLimitEnabled"
            defaultChecked={values.hardLimitEnabled}
            disabled={disabled}
            className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent/40 disabled:opacity-60"
          />
          <span className="space-y-0.5">
            <span className="block text-xs font-medium text-foreground">
              {t("settingsUsage.limitsForm.hardLimit")}
            </span>
            <span className="block text-[11px] text-muted/80">
              {t("settingsUsage.limitsForm.hardLimitHint")}
            </span>
          </span>
        </label>
      </div>

      {state.ok ? (
        <p role="status" className="text-xs text-emerald-600">
          {t("settingsUsage.limitsForm.saved")}
        </p>
      ) : state.errorCode ? (
        <p role="alert" className="text-xs text-rose-600">
          {t(state.errorCode)}
        </p>
      ) : null}

      {canManage ? (
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? t("common.saving") : t("common.saveChanges")}
        </button>
      ) : null}
    </form>
  );
}
