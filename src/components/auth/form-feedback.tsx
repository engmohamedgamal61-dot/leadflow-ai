interface FormFeedbackProps {
  error?: string;
  message?: string;
}

/** Inline error / info banner shared by the auth + onboarding forms. */
export function FormFeedback({ error, message }: FormFeedbackProps) {
  if (!error && !message) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={`rounded-lg border px-3 py-2 text-xs ${
        error
          ? "border-red-500/40 bg-red-500/10 text-red-300"
          : "border-accent/40 bg-accent/10 text-foreground"
      }`}
    >
      {error ?? message}
    </div>
  );
}

interface SubmitButtonProps {
  pending: boolean;
  children: React.ReactNode;
  pendingLabel?: string;
}

export function SubmitButton({
  pending,
  children,
  pendingLabel = "Please wait…",
}: SubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center justify-center rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
