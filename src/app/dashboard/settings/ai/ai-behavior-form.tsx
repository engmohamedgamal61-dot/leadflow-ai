"use client";

import { useActionState } from "react";
import {
  updateAiBehaviorAction,
  type SettingsFormState,
} from "@/lib/config/settings-actions";
import type { AiBehaviorConfig } from "@/lib/config";
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
  const [state, formAction, pending] = useActionState(
    updateAiBehaviorAction,
    INITIAL,
  );
  const disabled = !canManage || pending;

  return (
    <SectionShell
      title="Assistant behavior"
      description="How the AI agent introduces itself and talks. Blank fields fall back to the industry template."
    >
      <form action={formAction} className="space-y-4">
        <Field
          label="Identity / persona"
          name="persona"
          defaultValue={effective.persona}
          hint={`Template: ${templateDefaults.persona}`}
          disabled={disabled}
          rows={2}
        />
        <Field
          label="Goal"
          name="goal"
          defaultValue={effective.goal}
          disabled={disabled}
          rows={2}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tone" name="tone" defaultValue={effective.tone} disabled={disabled} rows={2} />
          <Field label="Style" name="style" defaultValue={effective.style} disabled={disabled} rows={2} />
        </div>
        <Field
          label="Languages (one per line)"
          name="languages"
          defaultValue={effective.languages.join("\n")}
          hint="The assistant understands and mirrors these. Replaces the template list."
          disabled={disabled}
          rows={3}
        />
        <Field
          label="Additional rules (one per line)"
          name="additionalRules"
          defaultValue={(effectiveOnlyRules(effective, templateDefaults)).join("\n")}
          hint="Appended after the template's built-in rules."
          disabled={disabled}
          rows={4}
        />
        <Field
          label="Domain context"
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
