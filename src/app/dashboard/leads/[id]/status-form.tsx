"use client";

import { useActionState, useState } from "react";
import {
  updateLeadStatusAction,
  type StatusFormState,
} from "@/lib/leads/actions";
import { LEAD_STATUSES } from "@/lib/leads/list-params";
import { humanizeKey } from "@/lib/leads/lead-view";

const INITIAL: StatusFormState = {};

/**
 * Remounted by the parent (via `key={current}`) whenever the persisted status
 * changes, so `useState(current)` always starts from the server truth.
 */
export function StatusForm({
  leadId,
  current,
}: {
  leadId: string;
  current: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateLeadStatusAction,
    INITIAL,
  );
  const [value, setValue] = useState(current);

  return (
    <form action={formAction} className="mt-3 space-y-2">
      <input type="hidden" name="leadId" value={leadId} />
      <select
        name="status"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={pending}
        aria-label="Lead status"
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent/60 disabled:opacity-50"
      >
        {LEAD_STATUSES.map((s) => (
          <option key={s} value={s}>
            {humanizeKey(s)}
          </option>
        ))}
      </select>

      <button
        type="submit"
        disabled={pending || value === current}
        className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Saving…" : "Update status"}
      </button>

      {state.error ? (
        <p role="alert" className="text-xs text-rose-400">
          {state.error}
        </p>
      ) : state.ok ? (
        <p role="status" className="text-xs text-emerald-400">
          Status updated.
        </p>
      ) : null}
    </form>
  );
}
