"use client";

import { useActionState, useState, useTransition } from "react";
import {
  disconnectCalendarAction,
  updateCalendarSettingsAction,
  type CalendarFormState,
} from "@/lib/calendar/connection-actions";
import type { CalendarConnectionView } from "@/lib/calendar/connections";
import { useI18n } from "@/i18n/client";

const INITIAL: CalendarFormState = {};
const WORKING_DAY_VALUES = [0, 1, 2, 3, 4, 5, 6] as const;
const HOUR_OPTIONS = Array.from({ length: 24 * 2 }, (_, i) => i * 30); // every 30 min, 0..1410

function Feedback({ state }: { state: CalendarFormState }) {
  const { t } = useI18n();
  if (state.errorCode) {
    return (
      <div role="alert" className="space-y-1 text-xs text-rose-600">
        <p>{t(state.errorCode)}</p>
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
        {state.messageCode ? t(state.messageCode) : t("settings.saved")}
      </p>
    );
  }
  return null;
}

function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

const STATUS_STYLE: Record<string, string> = {
  connected: "bg-emerald-500/15 text-emerald-700",
  disconnected: "bg-border/50 text-muted",
  error: "bg-rose-500/15 text-rose-700",
  pending: "bg-amber-500/15 text-amber-700",
};

export function GoogleCalendarSettings({
  connection,
  canManage,
  lastUpdated,
  connectUrl,
  banner,
}: {
  connection: CalendarConnectionView | null;
  canManage: boolean;
  lastUpdated: string | null;
  connectUrl: string;
  banner: { kind: "ok" | "error"; code: string } | null;
}) {
  const { t, tOptional } = useI18n();
  const [disconnectState, setDisconnectState] = useState<CalendarFormState>(INITIAL);
  const [disconnecting, startDisconnect] = useTransition();
  const [settingsState, saveSettings, savingSettings] = useActionState(
    updateCalendarSettingsAction,
    INITIAL,
  );

  const isConnected = connection?.status === "connected";
  const settings = connection?.settings;

  return (
    <section className="space-y-5 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t("calendar.title")}</h2>
          <p className="mt-0.5 text-xs text-muted">{t("calendar.description")}</p>
        </div>
        {connection ? (
          <span
            className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
              STATUS_STYLE[connection.status] ?? "bg-border/50 text-muted"
            }`}
          >
            {tOptional(`calendar.status.${connection.status}`) ?? connection.status}
          </span>
        ) : null}
      </div>

      {banner ? (
        <p
          role={banner.kind === "error" ? "alert" : "status"}
          className={`rounded-lg border px-3 py-2 text-xs ${
            banner.kind === "error"
              ? "border-rose-500/30 bg-rose-500/5 text-rose-700"
              : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700"
          }`}
        >
          {t(banner.code)}
        </p>
      ) : null}

      {connection ? (
        <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div className="flex justify-between gap-2">
            <dt className="text-muted">{t("calendar.fields.calendarEmail")}</dt>
            <dd className="truncate text-foreground">{connection.calendarEmail ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">{t("calendar.fields.timezone")}</dt>
            <dd className="text-foreground">{connection.timezone}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">{t("calendar.fields.updated")}</dt>
            <dd className="text-foreground">{lastUpdated ?? "—"}</dd>
          </div>
          {connection.lastError ? (
            <div className="sm:col-span-2">
              <dt className="text-muted">{t("calendar.fields.lastError")}</dt>
              <dd className="mt-0.5 text-rose-600/90">{connection.lastError}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="text-xs text-muted">{t("calendar.notConnected")}</p>
      )}

      {canManage ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={connectUrl}
              className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              {isConnected ? t("calendar.connect.updateButton") : t("calendar.connect.connectButton")}
            </a>
            {connection ? (
              <button
                type="button"
                disabled={disconnecting}
                onClick={() =>
                  startDisconnect(async () => {
                    setDisconnectState(await disconnectCalendarAction());
                  })
                }
                className="rounded-lg border border-border px-3 py-2 text-xs text-rose-600/80 hover:text-rose-600 disabled:opacity-50"
              >
                {disconnecting ? t("calendar.connect.disconnecting") : t("calendar.connect.disconnect")}
              </button>
            ) : null}
          </div>
          <Feedback state={disconnectState} />

          {isConnected && settings ? (
            <form
              action={saveSettings}
              className="space-y-3 rounded-lg border border-border bg-background/40 p-4"
            >
              <p className="text-xs font-medium text-foreground">{t("calendar.settings.title")}</p>
              <p className="text-[11px] text-muted/70">{t("calendar.settings.description")}</p>

              <fieldset className="space-y-1.5">
                <legend className="text-xs font-medium text-muted">
                  {t("calendar.settings.workingDays")}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {WORKING_DAY_VALUES.map((day) => (
                    <label
                      key={day}
                      className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-foreground"
                    >
                      <input
                        type="checkbox"
                        name="workingDays"
                        value={day}
                        defaultChecked={settings.workingDays.includes(day)}
                        className="h-3.5 w-3.5 accent-accent"
                      />
                      {t(`calendar.days.${day}`)}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted">{t("calendar.settings.startTime")}</span>
                  <select
                    name="startMinute"
                    defaultValue={settings.startMinute}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60"
                  >
                    {HOUR_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {minutesToLabel(m)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted">{t("calendar.settings.endTime")}</span>
                  <select
                    name="endMinute"
                    defaultValue={settings.endMinute}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60"
                  >
                    {[...HOUR_OPTIONS, 24 * 60].map((m) => (
                      <option key={m} value={m}>
                        {m === 24 * 60 ? "24:00" : minutesToLabel(m)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted">{t("calendar.settings.slotMinutes")}</span>
                  <input
                    type="number"
                    name="slotMinutes"
                    defaultValue={settings.slotMinutes}
                    min={10}
                    max={240}
                    step={5}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted">{t("calendar.settings.lookaheadDays")}</span>
                  <input
                    type="number"
                    name="lookaheadDays"
                    defaultValue={settings.lookaheadDays}
                    min={1}
                    max={60}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted">{t("calendar.settings.minNoticeMinutes")}</span>
                  <input
                    type="number"
                    name="minNoticeMinutes"
                    defaultValue={settings.minNoticeMinutes}
                    min={0}
                    max={10080}
                    step={15}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60"
                  />
                </label>
              </div>

              <input type="hidden" name="timezone" value={settings.timezone} />

              <button
                type="submit"
                disabled={savingSettings}
                className="rounded-lg border border-border px-3 py-2 text-xs text-muted hover:text-foreground disabled:opacity-50"
              >
                {savingSettings ? t("calendar.settings.saving") : t("calendar.settings.save")}
              </button>
              <Feedback state={settingsState} />
            </form>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
