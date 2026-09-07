"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { useI18n } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import { formatDateTime } from "@/lib/leads/format";
import type {
  DeliveryView,
  EndpointView,
  InboundActionView,
} from "@/lib/integrations/queries";
import {
  updateEndpointAction,
  setEndpointEnabledAction,
  deleteEndpointAction,
  rotateSecretAction,
  sendTestWebhookAction,
  retryDeliveryAction,
  type EndpointFormState,
} from "@/lib/integrations/endpoint-actions";
import { INBOUND_ACTIONS } from "@/lib/integrations/inbound-validation";
import { EventPicker } from "../../event-picker";
import { SecretCallout } from "../../secret-callout";

const INITIAL: EndpointFormState = {};

const DELIVERY_DOT: Record<DeliveryView["status"], string> = {
  succeeded: "bg-emerald-500",
  pending: "bg-sky-500",
  delivering: "bg-sky-500",
  failed: "bg-amber-500",
  dead: "bg-rose-500",
};

function Card({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function WebhookDetail({
  endpoint,
  deliveries,
  inbound,
  inboundUrl,
  canManage,
  locale,
}: {
  endpoint: EndpointView;
  deliveries: DeliveryView[];
  inbound: InboundActionView[];
  inboundUrl: string;
  canManage: boolean;
  locale: Locale;
}) {
  const { t } = useI18n();
  const router = useRouter();

  const [editState, editAction, editing] = useActionState(
    updateEndpointAction,
    INITIAL,
  );
  const [pending, startTransition] = useTransition();
  const [banner, setBanner] = useState<EndpointFormState>(INITIAL);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);

  const run = (fn: () => Promise<EndpointFormState>) =>
    startTransition(async () => {
      const res = await fn();
      setBanner(res);
      if (res.secret) setRotatedSecret(res.secret);
      router.refresh();
    });

  const fmt = (iso: string | null) =>
    iso ? formatDateTime(iso, locale) : t("integrationHub.detail.never");

  return (
    <div className="space-y-5">
      {banner.errorCode ? (
        <p role="alert" className="text-xs text-rose-600">
          {t(banner.errorCode)}
        </p>
      ) : banner.messageCode ? (
        <p role="status" className="text-xs text-emerald-600">
          {t(banner.messageCode)}
        </p>
      ) : null}

      {/* ── status / health ── */}
      <Card
        title={t("integrationHub.detail.status")}
        action={
          canManage ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setEndpointEnabledAction(endpoint.id, !endpoint.enabled))}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${
                endpoint.enabled
                  ? "border border-border text-muted hover:text-foreground"
                  : "bg-accent text-accent-foreground hover:opacity-90"
              }`}
            >
              {endpoint.enabled
                ? t("integrationHub.detail.disable")
                : t("integrationHub.detail.enable")}
            </button>
          ) : null
        }
      >
        <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-muted">{t("integrationHub.detail.status")}</dt>
            <dd className="mt-0.5 font-medium text-foreground">
              {endpoint.enabled
                ? t("integrationHub.detail.enabled")
                : t("integrationHub.detail.disabled")}
            </dd>
          </div>
          <div>
            <dt className="text-muted">{t("integrationHub.detail.lastSuccess")}</dt>
            <dd className="mt-0.5 text-foreground">{fmt(endpoint.lastSuccessAt)}</dd>
          </div>
          <div>
            <dt className="text-muted">{t("integrationHub.detail.lastFailure")}</dt>
            <dd className="mt-0.5 text-foreground">{fmt(endpoint.lastFailureAt)}</dd>
          </div>
          <div>
            <dt className="text-muted">
              {t("integrationHub.detail.consecutiveFailures")}
            </dt>
            <dd className="mt-0.5 tabular-nums text-foreground">
              {endpoint.consecutiveFailures}
            </dd>
          </div>
          <div>
            <dt className="text-muted">{t("integrationHub.detail.createdAt")}</dt>
            <dd className="mt-0.5 text-foreground">{fmt(endpoint.createdAt)}</dd>
          </div>
        </dl>
        {endpoint.lastError ? (
          <p className="rounded-md border border-rose-500/30 bg-rose-500/5 px-2.5 py-1.5 text-[11px] text-rose-600/90">
            {t("integrationHub.detail.lastError")}: {endpoint.lastError}
          </p>
        ) : null}
        {!endpoint.enabled && endpoint.disabledReason ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
            {t(`integrationHub.disabledReason.${endpoint.disabledReason}`)}
          </p>
        ) : null}
      </Card>

      {/* ── configuration ── */}
      {canManage ? (
        <Card
          title={t("integrationHub.detail.configTitle")}
          action={
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => sendTestWebhookAction(endpoint.id))}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-40"
            >
              {pending
                ? t("integrationHub.detail.sending")
                : t("integrationHub.detail.sendTest")}
            </button>
          }
        >
          <form action={editAction} className="space-y-3">
            <input type="hidden" name="endpointId" value={endpoint.id} />
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted">
                {t("integrationHub.form.name")}
              </span>
              <input
                name="name"
                required
                defaultValue={endpoint.name}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted">
                {t("integrationHub.form.url")}
              </span>
              <input
                name="url"
                type="url"
                required
                defaultValue={endpoint.url}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted">
                {t("integrationHub.form.description")}
              </span>
              <input
                name="description"
                defaultValue={endpoint.description ?? ""}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60"
              />
            </label>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted">
                {t("integrationHub.form.events")}
              </span>
              <EventPicker selected={endpoint.subscribedEvents} disabled={editing} />
            </div>
            <button
              type="submit"
              disabled={editing}
              className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
            >
              {editing
                ? t("integrationHub.form.saving")
                : t("integrationHub.form.save")}
            </button>
            {editState.errorCode ? (
              <div role="alert" className="space-y-1 text-xs text-rose-600">
                <p>{t(editState.errorCode)}</p>
                {editState.details?.length ? (
                  <ul className="list-inside list-disc text-rose-600/80">
                    {editState.details.map((d) => (
                      <li key={d}>{t(d)}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : editState.ok ? (
              <p className="text-xs text-emerald-600">{t("integrationHub.results.updated")}</p>
            ) : null}
          </form>
        </Card>
      ) : null}

      {/* ── signing secret ── */}
      <Card
        title={t("integrationHub.secret.title")}
        action={
          canManage ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => rotateSecretAction(endpoint.id))}
              className="rounded-lg border border-border px-3 py-1.5 text-[11px] text-rose-600/80 hover:text-rose-600 disabled:opacity-40"
            >
              {pending
                ? t("integrationHub.secret.rotating")
                : t("integrationHub.secret.rotate")}
            </button>
          ) : null
        }
      >
        <p className="text-xs text-muted">{t("integrationHub.secret.hint")}</p>
        <p className="text-xs text-foreground">
          {t("integrationHub.secret.current")}:{" "}
          <span dir="ltr" className="font-mono">
            {endpoint.secretHint}
          </span>
          {endpoint.secretRotatedAt ? (
            <span className="ms-2 text-muted">
              ({fmt(endpoint.secretRotatedAt)})
            </span>
          ) : null}
        </p>
        {rotatedSecret ? <SecretCallout secret={rotatedSecret} /> : null}
        {canManage ? (
          <p className="text-[11px] text-muted/70">
            {t("integrationHub.secret.rotateHint")}
          </p>
        ) : null}
      </Card>

      {/* ── delivery history ── */}
      <Card title={t("integrationHub.deliveries.title")}>
        {deliveries.length === 0 ? (
          <p className="text-xs text-muted">{t("integrationHub.deliveries.none")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-start text-[11px] text-muted">
                  <th className="py-1.5 pe-3 font-medium">
                    {t("integrationHub.deliveries.event")}
                  </th>
                  <th className="py-1.5 pe-3 font-medium">
                    {t("integrationHub.deliveries.status")}
                  </th>
                  <th className="py-1.5 pe-3 font-medium">
                    {t("integrationHub.deliveries.attempts")}
                  </th>
                  <th className="py-1.5 pe-3 font-medium">
                    {t("integrationHub.deliveries.code")}
                  </th>
                  <th className="py-1.5 pe-3 font-medium">
                    {t("integrationHub.deliveries.when")}
                  </th>
                  <th className="py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="py-1.5 pe-3 text-foreground">
                      {d.eventType}
                      {d.kind === "test" ? (
                        <span className="ms-1 rounded bg-border/60 px-1 text-[10px] text-muted">
                          {t("integrationHub.deliveries.test")}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 pe-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className={`h-1.5 w-1.5 rounded-full ${DELIVERY_DOT[d.status]}`}
                        />
                        {t(`integrationHub.deliveries.statuses.${d.status}`)}
                      </span>
                    </td>
                    <td className="py-1.5 pe-3 tabular-nums text-muted">
                      {d.attemptCount}/{d.maxAttempts}
                    </td>
                    <td className="py-1.5 pe-3 tabular-nums text-muted">
                      {d.lastStatusCode ?? "—"}
                    </td>
                    <td className="py-1.5 pe-3 text-muted">
                      {formatDateTime(d.createdAt, locale)}
                    </td>
                    <td className="py-1.5 text-end">
                      {canManage && (d.status === "failed" || d.status === "dead") ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => run(() => retryDeliveryAction(d.id))}
                          className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted hover:text-foreground disabled:opacity-40"
                        >
                          {t("integrationHub.deliveries.retry")}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── inbound actions ── */}
      <Card title={t("integrationHub.inbound.title")}>
        <p className="text-xs text-muted">{t("integrationHub.inbound.subtitle")}</p>
        <div className="space-y-1 rounded-md border border-border bg-background/40 p-2.5 text-[11px]">
          <p className="font-medium text-muted">{t("integrationHub.inbound.url")}</p>
          <code dir="ltr" className="block break-all text-foreground">{inboundUrl}</code>
          <p className="pt-1 font-medium text-muted">
            {t("integrationHub.inbound.allowed")}
          </p>
          <ul className="text-foreground">
            {INBOUND_ACTIONS.map((a) => (
              <li key={a}>· {t(`integrationHub.inbound.actions.${a}`)}</li>
            ))}
          </ul>
        </div>
        {inbound.length === 0 ? (
          <p className="text-xs text-muted">{t("integrationHub.inbound.none")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-start text-[11px] text-muted">
                  <th className="py-1.5 pe-3 font-medium">
                    {t("integrationHub.inbound.action")}
                  </th>
                  <th className="py-1.5 pe-3 font-medium">
                    {t("integrationHub.inbound.status")}
                  </th>
                  <th className="py-1.5 font-medium">
                    {t("integrationHub.inbound.when")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {inbound.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5 pe-3 text-foreground">
                      {t(`integrationHub.inbound.actions.${r.action}`, {})}
                    </td>
                    <td className="py-1.5 pe-3 text-muted">
                      {t(`integrationHub.inbound.statuses.${r.status}`, {})}
                      {r.errorCode ? ` (${r.errorCode})` : ""}
                    </td>
                    <td className="py-1.5 text-muted">
                      {formatDateTime(r.receivedAt, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── danger zone ── */}
      {canManage ? (
        <Card title={t("integrationHub.detail.dangerTitle")}>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(t("integrationHub.detail.deleteConfirm"))) return;
              startTransition(async () => {
                const res = await deleteEndpointAction(endpoint.id);
                if (res.ok) router.push("/dashboard/settings/integrations");
                else setBanner(res);
              });
            }}
            className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-500/10 disabled:opacity-40"
          >
            {t("integrationHub.detail.deleteEndpoint")}
          </button>
        </Card>
      ) : null}
    </div>
  );
}
