"use client";

import { useActionState, useTransition } from "react";
import {
  connectWhatsAppAction,
  disconnectWhatsAppAction,
  testWhatsAppConnectionAction,
  updateFollowUpTemplateAction,
  type WhatsAppFormState,
} from "@/lib/whatsapp/connection-actions";
import { useI18n } from "@/i18n/client";
import type { WhatsAppConnectionView } from "./page";

const INITIAL: WhatsAppFormState = {};

function Feedback({ state }: { state: WhatsAppFormState }) {
  const { t } = useI18n();
  if (state.errorCode) {
    return (
      <div role="alert" className="space-y-1 text-xs text-rose-600">
        <p>{t(state.errorCode, state.params)}</p>
        {state.details?.length ? (
          <ul className="list-inside list-disc text-rose-600/80">
            {state.details.map((d, i) => (
              <li key={i}>{t(d)}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  if (state.ok) {
    return (
      <p role="status" className="text-xs text-emerald-600">
        {state.messageCode ? t(state.messageCode, state.params) : t("settings.saved")}
      </p>
    );
  }
  return null;
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  placeholder,
  hint,
  disabled,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60 disabled:opacity-60"
      />
      {hint ? <span className="block text-[11px] text-muted/70">{hint}</span> : null}
    </label>
  );
}

const STATUS_STYLE: Record<string, string> = {
  connected: "bg-emerald-500/15 text-emerald-700",
  disconnected: "bg-border/50 text-muted",
  error: "bg-rose-500/15 text-rose-700",
  pending: "bg-amber-500/15 text-amber-700",
};

export function WhatsAppSettings({
  connection,
  canManage,
  lastUpdated,
}: {
  connection: WhatsAppConnectionView | null;
  canManage: boolean;
  lastUpdated: string | null;
}) {
  const { t, tOptional } = useI18n();
  const [connectState, connect, connecting] = useActionState(
    connectWhatsAppAction,
    INITIAL,
  );
  const [tplState, saveTpl, savingTpl] = useActionState(
    updateFollowUpTemplateAction,
    INITIAL,
  );
  const [pending, startTransition] = useTransition();

  const isConnected = connection?.status === "connected";
  const statusLabel = (s: string) =>
    tOptional(`whatsapp.status.${s}`) ?? s;

  return (
    <section className="space-y-5 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t("whatsapp.title")}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{t("whatsapp.description")}</p>
        </div>
        {connection ? (
          <span
            className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
              STATUS_STYLE[connection.status] ?? "bg-border/50 text-muted"
            }`}
          >
            {statusLabel(connection.status)}
          </span>
        ) : null}
      </div>

      {connection ? (
        <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div className="flex justify-between gap-2">
            <dt className="text-muted">{t("whatsapp.fields.displayNumber")}</dt>
            <dd className="text-foreground">{connection.displayPhoneNumber ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">{t("whatsapp.fields.phoneNumberId")}</dt>
            <dd className="truncate font-mono text-foreground">{connection.phoneNumberId}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">{t("whatsapp.fields.wabaId")}</dt>
            <dd className="truncate font-mono text-foreground">{connection.wabaId ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">{t("whatsapp.fields.updated")}</dt>
            <dd className="text-foreground">{lastUpdated ?? "—"}</dd>
          </div>
          {connection.lastError ? (
            <div className="sm:col-span-2">
              <dt className="text-muted">{t("whatsapp.fields.lastError")}</dt>
              <dd className="mt-0.5 text-rose-600/90">{connection.lastError}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="text-xs text-muted">{t("whatsapp.notConnected")}</p>
      )}

      {canManage ? (
        <>
          <form action={connect} className="space-y-3 rounded-lg border border-border bg-background/40 p-4">
            <p className="text-xs font-medium text-foreground">
              {isConnected
                ? t("whatsapp.connect.updateTitle")
                : t("whatsapp.connect.title")}
            </p>
            <Field
              label={t("whatsapp.connect.phoneNumberId")}
              name="phoneNumberId"
              defaultValue={connection?.phoneNumberId}
              placeholder="1234567890"
              hint={t("whatsapp.connect.phoneNumberIdHint")}
              disabled={connecting}
            />
            <Field
              label={t("whatsapp.connect.accessToken")}
              name="accessToken"
              type="password"
              placeholder="EAAG…"
              hint={t("whatsapp.connect.accessTokenHint")}
              disabled={connecting}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t("whatsapp.connect.wabaIdOptional")}
                name="wabaId"
                defaultValue={connection?.wabaId ?? ""}
                disabled={connecting}
              />
              <Field
                label={t("whatsapp.connect.displayNumberOptional")}
                name="displayPhoneNumber"
                defaultValue={connection?.displayPhoneNumber ?? ""}
                disabled={connecting}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={connecting}
                className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
              >
                {connecting
                  ? t("whatsapp.connect.connecting")
                  : isConnected
                    ? t("whatsapp.connect.update")
                    : t("whatsapp.connect.submit")}
              </button>
              {connection ? (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await testWhatsAppConnectionAction();
                      })
                    }
                    className="rounded-lg border border-border px-3 py-2 text-xs text-muted hover:text-foreground disabled:opacity-50"
                  >
                    {pending
                      ? t("whatsapp.connect.testing")
                      : t("whatsapp.connect.test")}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await disconnectWhatsAppAction();
                      })
                    }
                    className="rounded-lg border border-border px-3 py-2 text-xs text-rose-600/80 hover:text-rose-600 disabled:opacity-50"
                  >
                    {t("whatsapp.connect.disconnect")}
                  </button>
                </>
              ) : null}
            </div>
            <Feedback state={connectState} />
          </form>

          <form action={saveTpl} className="space-y-3 rounded-lg border border-border bg-background/40 p-4">
            <p className="text-xs font-medium text-foreground">
              {t("whatsapp.template.title")}
            </p>
            <p className="text-[11px] text-muted/70">
              {t("whatsapp.template.description")}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={t("whatsapp.template.name")}
                name="templateName"
                defaultValue={connection?.followUpTemplate?.name ?? ""}
                placeholder="lead_follow_up"
                disabled={savingTpl}
              />
              <Field
                label={t("whatsapp.template.language")}
                name="templateLanguage"
                defaultValue={connection?.followUpTemplate?.language ?? "en_US"}
                disabled={savingTpl}
              />
            </div>
            <button
              type="submit"
              disabled={savingTpl}
              className="rounded-lg border border-border px-3 py-2 text-xs text-muted hover:text-foreground disabled:opacity-50"
            >
              {savingTpl
                ? t("whatsapp.template.saving")
                : t("whatsapp.template.save")}
            </button>
            <Feedback state={tplState} />
          </form>
        </>
      ) : null}
    </section>
  );
}
