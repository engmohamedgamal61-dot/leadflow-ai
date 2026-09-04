"use client";

import { useActionState, useTransition } from "react";
import {
  connectWhatsAppAction,
  disconnectWhatsAppAction,
  testWhatsAppConnectionAction,
  updateFollowUpTemplateAction,
  type WhatsAppFormState,
} from "@/lib/whatsapp/connection-actions";
import type { WhatsAppConnectionView } from "./page";

const INITIAL: WhatsAppFormState = {};

function Feedback({ state }: { state: WhatsAppFormState }) {
  if (state.error) {
    return (
      <div role="alert" className="space-y-1 text-xs text-rose-400">
        <p>{state.error}</p>
        {state.details?.length ? (
          <ul className="list-inside list-disc text-rose-400/80">
            {state.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  if (state.ok) {
    return (
      <p role="status" className="text-xs text-emerald-400">
        {state.message ?? "Saved."}
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
  connected: "bg-emerald-500/15 text-emerald-300",
  disconnected: "bg-border/50 text-muted",
  error: "bg-rose-500/15 text-rose-300",
  pending: "bg-amber-500/15 text-amber-300",
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

  return (
    <section className="space-y-5 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">WhatsApp</h2>
          <p className="mt-0.5 text-xs text-muted">
            Meta WhatsApp Business Cloud API. Inbound messages enter the same
            qualification flow; scheduled follow-ups on the WhatsApp channel are
            delivered here.
          </p>
        </div>
        {connection ? (
          <span
            className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
              STATUS_STYLE[connection.status] ?? "bg-border/50 text-muted"
            }`}
          >
            {connection.status}
          </span>
        ) : null}
      </div>

      {connection ? (
        <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Display number</dt>
            <dd className="text-foreground">{connection.displayPhoneNumber ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Phone number ID</dt>
            <dd className="truncate font-mono text-foreground">{connection.phoneNumberId}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">WABA ID</dt>
            <dd className="truncate font-mono text-foreground">{connection.wabaId ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Updated</dt>
            <dd className="text-foreground">{lastUpdated ?? "—"}</dd>
          </div>
          {connection.lastError ? (
            <div className="sm:col-span-2">
              <dt className="text-muted">Last error</dt>
              <dd className="mt-0.5 text-rose-400/90">{connection.lastError}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="text-xs text-muted">Not connected.</p>
      )}

      {canManage ? (
        <>
          <form action={connect} className="space-y-3 rounded-lg border border-border bg-background/40 p-4">
            <p className="text-xs font-medium text-foreground">
              {isConnected ? "Update credentials" : "Connect"}
            </p>
            <Field
              label="Phone number ID"
              name="phoneNumberId"
              defaultValue={connection?.phoneNumberId}
              placeholder="1234567890"
              hint="From your Meta app → WhatsApp → API Setup."
              disabled={connecting}
            />
            <Field
              label="Access token"
              name="accessToken"
              type="password"
              placeholder="EAAG…"
              hint="Stored encrypted, server-side only. Never shown again."
              disabled={connecting}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="WABA ID (optional)" name="wabaId" defaultValue={connection?.wabaId ?? ""} disabled={connecting} />
              <Field
                label="Display number (optional)"
                name="displayPhoneNumber"
                defaultValue={connection?.displayPhoneNumber ?? ""}
                disabled={connecting}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={connecting}
                className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
              >
                {connecting ? "Connecting…" : isConnected ? "Update" : "Connect WhatsApp"}
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
                    {pending ? "Testing…" : "Test connection"}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await disconnectWhatsAppAction();
                      })
                    }
                    className="rounded-lg border border-border px-3 py-2 text-xs text-rose-400/80 hover:text-rose-400 disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                </>
              ) : null}
            </div>
            <Feedback state={connectState} />
          </form>

          <form action={saveTpl} className="space-y-3 rounded-lg border border-border bg-background/40 p-4">
            <p className="text-xs font-medium text-foreground">
              Out-of-window follow-up template
            </p>
            <p className="text-[11px] text-muted/70">
              Meta only allows free-form messages within 24 hours of the
              customer&apos;s last message. Set an approved template name for
              follow-ups sent later. Leave blank to skip such follow-ups (they
              fail with a clear reason rather than sending an invalid message).
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Template name"
                name="templateName"
                defaultValue={connection?.followUpTemplate?.name ?? ""}
                placeholder="lead_follow_up"
                disabled={savingTpl}
              />
              <Field
                label="Language code"
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
              {savingTpl ? "Saving…" : "Save template"}
            </button>
            <Feedback state={tplState} />
          </form>
        </>
      ) : null}
    </section>
  );
}
