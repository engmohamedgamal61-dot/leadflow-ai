import type { ReactNode } from "react";
import type { SettingsFormState } from "@/lib/config/settings-actions";

export function SectionShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function Feedback({ state }: { state: SettingsFormState }) {
  if (state.ok) {
    return (
      <p role="status" className="text-xs text-emerald-400">
        Saved.
      </p>
    );
  }
  if (state.error) {
    return (
      <div role="alert" className="space-y-1 text-xs text-rose-400">
        <p>{state.error}</p>
        {state.details?.length ? (
          <ul className="list-inside list-disc text-rose-400/80">
            {state.details.slice(0, 6).map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  return null;
}

export function SaveButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}
