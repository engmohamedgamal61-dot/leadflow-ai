"use client";

import { useActionState } from "react";
import {
  updateScoringAction,
  type SettingsFormState,
} from "@/lib/config/settings-actions";
import { useI18n } from "@/i18n/client";
import { SectionShell, Feedback, SaveButton } from "./section-ui";

const INITIAL: SettingsFormState = {};

export function ScoringForm({
  hot,
  warm,
  templateHot,
  templateWarm,
  maxScore,
  canManage,
}: {
  hot: number;
  warm: number;
  templateHot: number;
  templateWarm: number;
  maxScore: number;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const [state, formAction, pending] = useActionState(
    updateScoringAction,
    INITIAL,
  );
  const disabled = !canManage || pending;

  return (
    <SectionShell
      title={t("settingsAi.scoring.title")}
      description={t("settingsAi.scoring.description", { max: maxScore })}
    >
      <form action={formAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted">
              {t("settingsAi.scoring.hotAt")}
            </span>
            <input
              type="number"
              name="hot"
              defaultValue={hot}
              min={0}
              max={100}
              disabled={disabled}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60 disabled:opacity-60"
            />
            <span className="block text-[11px] text-muted/70">
              {t("settingsAi.scoring.template", { value: templateHot })}
            </span>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted">
              {t("settingsAi.scoring.warmAt")}
            </span>
            <input
              type="number"
              name="warm"
              defaultValue={warm}
              min={0}
              max={100}
              disabled={disabled}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60 disabled:opacity-60"
            />
            <span className="block text-[11px] text-muted/70">
              {t("settingsAi.scoring.template", { value: templateWarm })}
            </span>
          </label>
        </div>
        <p className="text-[11px] text-muted/70">{t("settingsAi.scoring.note")}</p>

        <Feedback state={state} />
        {canManage ? <SaveButton pending={pending} /> : null}
      </form>
    </SectionShell>
  );
}
