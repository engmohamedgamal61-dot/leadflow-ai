"use client";

import { useActionState, useState } from "react";
import {
  setWidgetEnabledAction,
  rotateWidgetKeyAction,
  saveWidgetOriginsAction,
  type WidgetFormState,
} from "@/lib/org/widget-actions";
import { useI18n } from "@/i18n/client";

const INITIAL: WidgetFormState = {};

function CopyBox({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2">
      <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-background/50 p-3 text-[11px] text-foreground">
        {value}
      </pre>
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:text-foreground"
      >
        {copied ? t("common.done") : t("widget.copy")}
      </button>
    </div>
  );
}

export function WidgetForm({
  enabled,
  widgetKey,
  embedSnippet,
  widgetUrl,
  originsText,
}: {
  enabled: boolean;
  widgetKey: string;
  embedSnippet: string;
  widgetUrl: string;
  originsText: string;
}) {
  const { t } = useI18n();
  const [toggleState, toggleAction, toggling] = useActionState(setWidgetEnabledAction, INITIAL);
  const [rotateState, rotateFormAction, rotating] = useActionState(
    async () => rotateWidgetKeyAction(),
    INITIAL,
  );
  const [originsState, originsAction, savingOrigins] = useActionState(
    saveWidgetOriginsAction,
    INITIAL,
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t("widget.statusTitle")}</h2>
            <p className="mt-0.5 text-xs text-muted">
              {enabled ? t("widget.enabledHint") : t("widget.disabledHint")}
            </p>
          </div>
          <form action={toggleAction}>
            <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
            <button
              type="submit"
              disabled={toggling}
              className={`rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-40 ${
                enabled
                  ? "border border-border text-muted hover:text-foreground"
                  : "bg-accent text-accent-foreground hover:opacity-90"
              }`}
            >
              {enabled ? t("widget.disable") : t("widget.enable")}
            </button>
          </form>
        </div>
        {toggleState.errorCode ? (
          <p className="text-xs text-rose-600">{t(toggleState.errorCode)}</p>
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">{t("widget.embedTitle")}</h2>
        <p className="text-xs text-muted">{t("widget.embedHint")}</p>
        <CopyBox value={embedSnippet} label={t("widget.copySnippet")} />
        <p className="text-[11px] text-muted">
          {t("widget.previewHint")}{" "}
          <a
            href={widgetUrl}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            {t("widget.openPreview")}
          </a>
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">{t("widget.keyTitle")}</h2>
          <form action={rotateFormAction}>
            <button
              type="submit"
              disabled={rotating}
              className="rounded-lg border border-border px-3 py-1.5 text-[11px] text-rose-600/80 hover:text-rose-600 disabled:opacity-40"
            >
              {t("widget.rotateKey")}
            </button>
          </form>
        </div>
        <CopyBox value={widgetKey} label={t("widget.copyKey")} />
        <p className="text-[11px] text-muted">{t("widget.rotateHint")}</p>
        {rotateState.errorCode ? (
          <p className="text-xs text-rose-600">{t(rotateState.errorCode)}</p>
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">{t("widget.originsTitle")}</h2>
        <p className="text-xs text-muted">{t("widget.originsHint")}</p>
        {enabled && !originsText.trim() ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
            {t("widget.originsRequired")}
          </p>
        ) : null}
        <form action={originsAction} className="space-y-2">
          <textarea
            name="origins"
            rows={3}
            defaultValue={originsText}
            placeholder="https://www.acme.com"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60"
          />
          <button
            type="submit"
            disabled={savingOrigins}
            className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:opacity-40"
          >
            {savingOrigins ? t("common.saving") : t("common.saveChanges")}
          </button>
          {originsState.ok ? (
            <p className="text-xs text-emerald-600">{t("settings.saved")}</p>
          ) : null}
          {originsState.errorCode ? (
            <p className="text-xs text-rose-600">
              {t(originsState.errorCode)}
              {originsState.invalidOrigins?.length
                ? `: ${originsState.invalidOrigins.join(", ")}`
                : ""}
            </p>
          ) : null}
        </form>
      </section>
    </div>
  );
}
