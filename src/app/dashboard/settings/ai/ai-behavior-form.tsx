"use client";

import { useActionState } from "react";
import {
  updateAiBehaviorAction,
  type SettingsFormState,
} from "@/lib/config/settings-actions";
import type { AiBehaviorConfig } from "@/lib/config";
import { useI18n } from "@/i18n/client";
import { SectionShell, Feedback, SaveButton } from "./section-ui";

const INITIAL: SettingsFormState = {};

function Field({
  label,
  name,
  defaultValue,
  hint,
  disabled,
  rows,
}: {
  label: string;
  name: string;
  defaultValue: string;
  hint?: string;
  disabled: boolean;
  rows?: number;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      {rows ? (
        <textarea
          name={name}
          defaultValue={defaultValue}
          disabled={disabled}
          rows={rows}
          className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60 disabled:opacity-60"
        />
      ) : (
        <input
          name={name}
          defaultValue={defaultValue}
          disabled={disabled}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60 disabled:opacity-60"
        />
      )}
      {hint ? <span className="block text-[11px] text-muted/70">{hint}</span> : null}
    </label>
  );
}

export function AiBehaviorForm({
  effective,
  templateDefaults,
  canManage,
}: {
  effective: AiBehaviorConfig;
  templateDefaults: AiBehaviorConfig;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(
    updateAiBehaviorAction,
    INITIAL,
  );
  const disabled = !canManage || pending;

  return (
    <SectionShell
      title={t("settingsAi.behavior.title")}
      description={t("settingsAi.behavior.description")}
    >
      <form action={formAction} className="space-y-4">
        <Field
          label={t("settingsAi.behavior.persona")}
          name="persona"
          defaultValue={effective.persona}
          hint={t("settingsAi.behavior.templateHint", {
            value: templateDefaults.persona,
          })}
          disabled={disabled}
          rows={2}
        />
        <Field
          label={t("settingsAi.behavior.goal")}
          name="goal"
          defaultValue={effective.goal}
          disabled={disabled}
          rows={2}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("settingsAi.behavior.tone")}
            name="tone"
            defaultValue={effective.tone}
            disabled={disabled}
            rows={2}
          />
          <Field
            label={t("settingsAi.behavior.style")}
            name="style"
            defaultValue={effective.style}
            disabled={disabled}
            rows={2}
          />
        </div>
        <Field
          label={t("settingsAi.behavior.languages")}
          name="languages"
          defaultValue={effective.languages.join("\n")}
          hint={t("settingsAi.behavior.languagesHint")}
          disabled={disabled}
          rows={3}
        />
        <Field
          label={t("settingsAi.behavior.additionalRules")}
          name="additionalRules"
          defaultValue={effectiveOnlyRules(effective, templateDefaults).join("\n")}
          hint={t("settingsAi.behavior.additionalRulesHint")}
          disabled={disabled}
          rows={4}
        />
        <Field
          label={t("settingsAi.behavior.domainContext")}
          name="domainContext"
          defaultValue={effective.domainContext ?? ""}
          disabled={disabled}
          rows={2}
        />

        <Feedback state={state} />
        {canManage ? <SaveButton pending={pending} /> : null}
      </form>
    </SectionShell>
  );
}

/** Rules that were added on top of the template (the editable "additional" set). */
function effectiveOnlyRules(
  effective: AiBehaviorConfig,
  template: AiBehaviorConfig,
): string[] {
  const templateSet = new Set(template.rules);
  return effective.rules.filter((r) => !templateSet.has(r));
}
