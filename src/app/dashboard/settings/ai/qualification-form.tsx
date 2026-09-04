"use client";

import { useActionState, useState } from "react";
import {
  updateQualificationAction,
  type SettingsFormState,
} from "@/lib/config/settings-actions";
import { useI18n } from "@/i18n/client";
import { SectionShell, Feedback, SaveButton } from "./section-ui";

export interface QualRow {
  key: string;
  label: string;
  enabled: boolean;
  order: number;
  questionHint: string;
  inFlow: boolean;
}

const INITIAL: SettingsFormState = {};

export function QualificationForm({
  rows: initialRows,
  canManage,
}: {
  rows: QualRow[];
  canManage: boolean;
}) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(
    updateQualificationAction,
    INITIAL,
  );
  const [rows, setRows] = useState(initialRows);
  const disabled = !canManage || pending;

  const patch = (key: string, next: Partial<QualRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...next } : r)));

  const enabledCount = rows.filter((r) => r.enabled).length;

  const payload = JSON.stringify(
    rows.map(({ key, enabled, order, questionHint }) => ({
      key,
      enabled,
      order,
      questionHint,
    })),
  );

  return (
    <SectionShell
      title={t("settingsAi.qualification.title")}
      description={t("settingsAi.qualification.description")}
    >
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="rows" value={payload} />

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-start text-[11px] text-muted">
                <th className="py-1.5 pe-3 font-medium">
                  {t("settingsAi.qualification.colOn")}
                </th>
                <th className="py-1.5 pe-3 font-medium">
                  {t("settingsAi.qualification.colField")}
                </th>
                <th className="py-1.5 pe-3 font-medium">
                  {t("settingsAi.qualification.colOrder")}
                </th>
                <th className="py-1.5 font-medium">
                  {t("settingsAi.qualification.colHint")}
                </th>
              </tr>
            </thead>
            <tbody>
              {[...rows]
                .sort((a, b) => a.order - b.order)
                .map((r) => (
                  <tr key={r.key} className="border-t border-border/60">
                    <td className="py-2 pe-3 align-top">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        disabled={disabled}
                        onChange={(e) => patch(r.key, { enabled: e.target.checked })}
                        aria-label={t("settingsAi.qualification.enableField", {
                          field: r.label,
                        })}
                        className="mt-1 h-3.5 w-3.5 accent-accent"
                      />
                    </td>
                    <td className="py-2 pe-3 align-top">
                      <span className="text-foreground">{r.label}</span>
                      <span className="block text-[11px] text-muted/60">{r.key}</span>
                    </td>
                    <td className="py-2 pe-3 align-top">
                      <input
                        type="number"
                        value={r.order}
                        min={0}
                        max={100000}
                        disabled={disabled}
                        onChange={(e) =>
                          patch(r.key, { order: Number(e.target.value) })
                        }
                        aria-label={t("settingsAi.qualification.orderFor", {
                          field: r.label,
                        })}
                        className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-accent/60 disabled:opacity-60"
                      />
                    </td>
                    <td className="py-2 align-top">
                      <input
                        type="text"
                        value={r.questionHint}
                        disabled={disabled || !r.enabled}
                        placeholder={
                          r.inFlow ? "" : t("settingsAi.qualification.notInFlow")
                        }
                        onChange={(e) =>
                          patch(r.key, { questionHint: e.target.value })
                        }
                        aria-label={t("settingsAi.qualification.hintFor", {
                          field: r.label,
                        })}
                        className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-accent/60 disabled:opacity-50"
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {enabledCount === 0 ? (
          <p className="text-xs text-rose-400">
            {t("settingsAi.qualification.minOneField")}
          </p>
        ) : null}

        <Feedback state={state} />
        {canManage ? <SaveButton pending={pending} /> : null}
      </form>
    </SectionShell>
  );
}
