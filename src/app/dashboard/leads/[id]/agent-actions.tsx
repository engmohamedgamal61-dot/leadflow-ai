"use client";

import { useActionState, useRef, useState } from "react";
import {
  createFollowUpAction,
  completeFollowUpAction,
  cancelFollowUpAction,
  requestHandoffAction,
  markQualifiedAction,
  type AgentFormState,
} from "@/lib/leads/follow-up-actions";
import { formatDateTime } from "@/lib/leads/format";
import type { FollowUpRow } from "@/lib/leads/queries";

const INITIAL: AgentFormState = {};

function Msg({ state }: { state: AgentFormState }) {
  if (state.error) {
    return <p role="alert" className="text-xs text-rose-400">{state.error}</p>;
  }
  if (state.ok) {
    return <p role="status" className="text-xs text-emerald-400">Done.</p>;
  }
  return null;
}

export function AddFollowUpForm({ leadId }: { leadId: string }) {
  const [state, formAction, pending] = useActionState(
    createFollowUpAction,
    INITIAL,
  );
  const [local, setLocal] = useState("");
  const isoRef = useRef<HTMLInputElement>(null);

  // Convert the local datetime-local value to a proper ISO string on submit.
  const onSubmit = () => {
    if (isoRef.current && local) {
      const d = new Date(local);
      isoRef.current.value = Number.isNaN(d.getTime()) ? "" : d.toISOString();
    }
  };

  return (
    <form
      action={formAction}
      onSubmit={onSubmit}
      className="space-y-2 rounded-lg border border-border bg-background/40 p-3"
    >
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="scheduledAt" ref={isoRef} />
      <label className="block text-[11px] font-medium text-muted">
        Schedule a follow-up
      </label>
      <input
        type="datetime-local"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        required
        aria-label="Follow-up date and time"
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent/60"
      />
      <input
        type="text"
        name="note"
        placeholder="Note (optional)"
        maxLength={500}
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent/60"
      />
      <button
        type="submit"
        disabled={pending || !local}
        className="w-full rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "Saving…" : "Add follow-up"}
      </button>
      <Msg state={state} />
    </form>
  );
}

export function FollowUpItem({
  followUp,
  canWrite,
}: {
  followUp: FollowUpRow;
  canWrite: boolean;
}) {
  const [completeState, complete, completing] = useActionState(
    completeFollowUpAction,
    INITIAL,
  );
  const [cancelState, cancel, cancelling] = useActionState(
    cancelFollowUpAction,
    INITIAL,
  );

  const badgeStyles: Record<string, string> = {
    pending: "bg-amber-500/15 text-amber-300",
    processing: "bg-sky-500/15 text-sky-300",
    completed: "bg-emerald-500/15 text-emerald-300",
    failed: "bg-rose-500/15 text-rose-300",
  };
  const badge = badgeStyles[followUp.status] ?? "bg-border/50 text-muted";

  return (
    <li className="rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-foreground">
            {formatDateTime(followUp.scheduledAt)}
          </p>
          {followUp.note ? (
            <p className="mt-0.5 truncate text-xs text-muted">{followUp.note}</p>
          ) : null}
          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted/60">
            {followUp.source} · {followUp.channel}
            {followUp.attemptCount > 0 ? ` · ${followUp.attemptCount} attempt${followUp.attemptCount > 1 ? "s" : ""}` : ""}
          </p>
          {followUp.status === "completed" && followUp.completedAt ? (
            <p className="mt-0.5 text-[11px] text-emerald-400/80">
              Sent {formatDateTime(followUp.completedAt)}
            </p>
          ) : null}
          {followUp.status === "failed" && followUp.lastError ? (
            <p className="mt-0.5 text-[11px] text-rose-400/90">
              {followUp.lastError}
            </p>
          ) : null}
          {followUp.status === "pending" &&
          followUp.attemptCount > 0 &&
          followUp.nextAttemptAt ? (
            <p className="mt-0.5 text-[11px] text-amber-400/80">
              Retry {formatDateTime(followUp.nextAttemptAt)}
            </p>
          ) : null}
        </div>
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium ${badge}`}>
          {followUp.status}
        </span>
      </div>

      {canWrite && followUp.status === "pending" ? (
        <div className="mt-2 flex gap-2">
          <form action={complete}>
            <input type="hidden" name="followUpId" value={followUp.id} />
            <button
              type="submit"
              disabled={completing}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:text-foreground disabled:opacity-40"
            >
              {completing ? "…" : "Complete"}
            </button>
          </form>
          <form action={cancel}>
            <input type="hidden" name="followUpId" value={followUp.id} />
            <button
              type="submit"
              disabled={cancelling}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:text-foreground disabled:opacity-40"
            >
              {cancelling ? "…" : "Cancel"}
            </button>
          </form>
        </div>
      ) : null}
      <Msg state={completeState.error ? completeState : cancelState} />
    </li>
  );
}

export function HandoffButton({ leadId }: { leadId: string }) {
  const [state, formAction, pending] = useActionState(
    requestHandoffAction,
    INITIAL,
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-border px-3 py-2 text-xs text-muted hover:text-foreground"
      >
        Request human handoff
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="leadId" value={leadId} />
      <input
        type="text"
        name="reason"
        placeholder="Reason (optional)"
        maxLength={200}
        autoFocus
        className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent/60"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "…" : "Flag for a human"}
      </button>
      <Msg state={state} />
    </form>
  );
}

export function MarkQualifiedButton({ leadId }: { leadId: string }) {
  const [state, formAction, pending] = useActionState(
    markQualifiedAction,
    INITIAL,
  );
  return (
    <form action={formAction}>
      <input type="hidden" name="leadId" value={leadId} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-xs font-medium text-foreground hover:bg-accent/20 disabled:opacity-40"
      >
        {pending ? "…" : "Mark qualified"}
      </button>
      <Msg state={state} />
    </form>
  );
}
