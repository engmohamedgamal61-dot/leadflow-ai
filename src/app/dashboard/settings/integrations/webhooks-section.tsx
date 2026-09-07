"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { EndpointView } from "@/lib/integrations/queries";
import {
  createEndpointAction,
  type EndpointFormState,
} from "@/lib/integrations/endpoint-actions";
import { EventPicker } from "./event-picker";
import { SecretCallout } from "./secret-callout";

const INITIAL: EndpointFormState = {};

const HEALTH_DOT: Record<EndpointView["health"], string> = {
  ok: "bg-emerald-500",
  failing: "bg-rose-500",
  never: "bg-border",
  disabled: "bg-amber-500",
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function Feedback({ state }: { state: EndpointFormState }) {
  const { t } = useI18n();
  if (state.errorCode) {
    return (
      <div role="alert" className="space-y-1 text-xs text-rose-600">
        <p>{t(state.errorCode)}</p>
        {state.details?.length ? (
          <ul className="list-inside list-disc text-rose-600/80">
            {state.details.map((d) => (
              <li key={d}>{t(d)}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  return null;
}

export function WebhooksSection({
  endpoints,
  canManage,
}: {
  endpoints: EndpointView[];
  canManage: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createEndpointAction, INITIAL);

  const justCreated = state.ok && state.secret;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t("integrationHub.title")}
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-muted">
            {t("integrationHub.description")}
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent/50"
          >
            {open ? t("integrationHub.form.cancel") : t("integrationHub.addEndpoint")}
          </button>
        ) : null}
      </div>

      {!canManage ? (
        <p className="inline-block rounded-md border border-border bg-background px-2 py-1 text-xs text-muted">
          {t("integrationHub.readonly")}
        </p>
      ) : null}

      {justCreated ? (
        <div className="space-y-2">
          <SecretCallout secret={state.secret as string} />
          {state.endpointId ? (
            <Link
              href={`/dashboard/settings/integrations/webhooks/${state.endpointId}`}
              className="inline-block text-xs font-medium text-accent hover:underline"
            >
              {t("integrationHub.manage")} →
            </Link>
          ) : null}
        </div>
      ) : null}

      {open && canManage && !justCreated ? (
        <form
          action={action}
          className="space-y-3 rounded-lg border border-border bg-background/40 p-4"
        >
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted">
              {t("integrationHub.form.name")}
            </span>
            <input
              name="name"
              required
              placeholder={t("integrationHub.form.namePlaceholder")}
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
              placeholder={t("integrationHub.form.urlPlaceholder")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60"
            />
            <span className="block text-[11px] text-muted/70">
              {t("integrationHub.form.urlHint")}
            </span>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted">
              {t("integrationHub.form.description")}
            </span>
            <input
              name="description"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60"
            />
          </label>
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted">
              {t("integrationHub.form.events")}
            </span>
            <EventPicker selected={[]} disabled={pending} />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
          >
            {pending
              ? t("integrationHub.form.creating")
              : t("integrationHub.form.create")}
          </button>
          <Feedback state={state} />
        </form>
      ) : null}

      {endpoints.length === 0 ? (
        <p className="text-xs text-muted">{t("integrationHub.noEndpoints")}</p>
      ) : (
        <ul className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border">
          {endpoints.map((e) => (
            <li key={e.id}>
              <Link
                href={`/dashboard/settings/integrations/webhooks/${e.id}`}
                className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-background"
              >
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${HEALTH_DOT[e.health]}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">
                    {e.name}
                  </span>
                  <span className="block truncate text-[11px] text-muted">
                    {hostOf(e.url)} ·{" "}
                    {t("integrationHub.subscribedCount", {
                      count: e.subscribedEvents.length,
                    })}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-muted">
                  {t(`integrationHub.health.${e.health}`)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
