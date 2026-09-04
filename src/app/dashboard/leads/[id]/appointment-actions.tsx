"use client";

import { useActionState, useState } from "react";
import {
  manualBookAppointmentAction,
  manualRescheduleAppointmentAction,
  manualCancelAppointmentAction,
  type AppointmentFormState,
} from "@/lib/calendar/appointment-actions";
import { formatDateTime } from "@/lib/leads/format";
import type { AppointmentRow } from "@/lib/leads/queries";
import { useI18n } from "@/i18n/client";
import type { Locale } from "@/i18n/config";

const INITIAL: AppointmentFormState = {};
const ACTIVE_STATUSES = new Set(["scheduled", "rescheduled"]);

function Msg({ state }: { state: AppointmentFormState }) {
  const { t } = useI18n();
  if (state.errorCode) {
    return (
      <p role="alert" className="text-xs text-rose-400">
        {t(state.errorCode)}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p role="status" className="text-xs text-emerald-400">
        {t("common.done")}
      </p>
    );
  }
  return null;
}

interface Slot {
  startsAt: string;
  endsAt: string;
}

function SlotSelect({
  name,
  slots,
  locale,
}: {
  name: string;
  slots: Slot[];
  locale: Locale;
}) {
  const { t } = useI18n();
  return (
    <select
      name={name}
      required
      aria-label={t("leadDetail.appointments.slotLabel")}
      className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent/60"
    >
      {slots.map((slot) => (
        <option key={slot.startsAt} value={slot.startsAt}>
          {formatDateTime(slot.startsAt, locale)}
        </option>
      ))}
    </select>
  );
}

export function BookAppointmentForm({
  leadId,
  availableSlots,
  calendarConnected,
}: {
  leadId: string;
  availableSlots: Slot[];
  calendarConnected: boolean;
}) {
  const { t, locale } = useI18n();
  const [state, formAction, pending] = useActionState(manualBookAppointmentAction, INITIAL);

  if (!calendarConnected) {
    return <p className="text-[11px] text-muted/70">{t("leadDetail.appointments.notConnected")}</p>;
  }
  if (availableSlots.length === 0) {
    return <p className="text-[11px] text-muted/70">{t("leadDetail.appointments.noSlots")}</p>;
  }

  return (
    <form
      action={formAction}
      className="space-y-2 rounded-lg border border-border bg-background/40 p-3"
    >
      <input type="hidden" name="leadId" value={leadId} />
      <label className="block text-[11px] font-medium text-muted">
        {t("leadDetail.appointments.book")}
      </label>
      <SlotSelect name="startsAt" slots={availableSlots} locale={locale} />
      <input
        type="text"
        name="notes"
        placeholder={t("leadDetail.appointments.notesOptional")}
        maxLength={500}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent/60"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:opacity-40"
      >
        {pending ? t("common.saving") : t("leadDetail.appointments.bookAction")}
      </button>
      <Msg state={state} />
    </form>
  );
}

export function AppointmentItem({
  appointment,
  canWrite,
  availableSlots,
}: {
  appointment: AppointmentRow;
  canWrite: boolean;
  availableSlots: Slot[];
}) {
  const { t, tOptional, locale } = useI18n();
  const [rescheduleState, reschedule, rescheduling] = useActionState(
    manualRescheduleAppointmentAction,
    INITIAL,
  );
  const [cancelState, cancel, cancelling] = useActionState(
    manualCancelAppointmentAction,
    INITIAL,
  );
  const [mode, setMode] = useState<"view" | "reschedule" | "cancel">("view");

  const badgeStyles: Record<string, string> = {
    scheduled: "bg-emerald-500/15 text-emerald-300",
    rescheduled: "bg-sky-500/15 text-sky-300",
    cancelled: "bg-rose-500/15 text-rose-300",
    completed: "bg-border/50 text-muted",
    no_show: "bg-amber-500/15 text-amber-300",
  };
  const badge = badgeStyles[appointment.status] ?? "bg-border/50 text-muted";
  const isActive = ACTIVE_STATUSES.has(appointment.status);
  const sourceLabel = tOptional(`followUps.source.${appointment.source}`) ?? appointment.source;

  return (
    <li className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-foreground">{formatDateTime(appointment.startsAt, locale)}</p>
          {appointment.notes ? (
            <p className="mt-0.5 truncate text-xs text-muted">{appointment.notes}</p>
          ) : null}
          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted/60">{sourceLabel}</p>
          {appointment.status === "cancelled" && appointment.cancelledReason ? (
            <p className="mt-0.5 text-[11px] text-rose-400/90">{appointment.cancelledReason}</p>
          ) : null}
        </div>
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium ${badge}`}>
          {tOptional(`appointmentStatuses.${appointment.status}`) ?? appointment.status}
        </span>
      </div>

      {canWrite && isActive ? (
        <div className="mt-2 space-y-2">
          {mode === "view" ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("reschedule")}
                className="rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:text-foreground"
              >
                {t("leadDetail.appointments.reschedule")}
              </button>
              <button
                type="button"
                onClick={() => setMode("cancel")}
                className="rounded-md border border-border px-2 py-1 text-[11px] text-rose-400/80 hover:text-rose-400"
              >
                {t("leadDetail.appointments.cancel")}
              </button>
            </div>
          ) : null}

          {mode === "reschedule" ? (
            <form action={reschedule} className="space-y-2">
              <input type="hidden" name="leadId" value={appointment.leadId} />
              <p className="text-[11px] font-medium text-muted">
                {t("leadDetail.appointments.rescheduleTitle")}
              </p>
              {availableSlots.length > 0 ? (
                <SlotSelect name="newStartsAt" slots={availableSlots} locale={locale} />
              ) : (
                <p className="text-[11px] text-muted/70">{t("leadDetail.appointments.noSlots")}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={rescheduling || availableSlots.length === 0}
                  className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-accent-foreground disabled:opacity-40"
                >
                  {rescheduling ? "…" : t("leadDetail.appointments.reschedule")}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("view")}
                  className="rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:text-foreground"
                >
                  {t("common.cancel")}
                </button>
              </div>
              <Msg state={rescheduleState} />
            </form>
          ) : null}

          {mode === "cancel" ? (
            <form action={cancel} className="space-y-2">
              <input type="hidden" name="leadId" value={appointment.leadId} />
              <p className="text-[11px] font-medium text-muted">
                {t("leadDetail.appointments.cancelTitle")}
              </p>
              <input
                type="text"
                name="reason"
                placeholder={t("leadDetail.appointments.cancelReasonOptional")}
                maxLength={200}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent/60"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={cancelling}
                  className="rounded-md bg-rose-500/90 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
                >
                  {cancelling ? "…" : t("leadDetail.appointments.confirmCancel")}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("view")}
                  className="rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:text-foreground"
                >
                  {t("leadDetail.appointments.keep")}
                </button>
              </div>
              <Msg state={cancelState} />
            </form>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
