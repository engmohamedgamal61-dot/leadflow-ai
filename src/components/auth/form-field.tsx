import type { InputHTMLAttributes, ReactNode } from "react";

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  error?: string;
  hint?: ReactNode;
}

export function FormField({ label, name, error, hint, ...input }: FormFieldProps) {
  const describedBy = error
    ? `${name}-error`
    : hint
      ? `${name}-hint`
      : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-xs font-medium text-muted">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/60 outline-none transition-colors focus:border-accent/60 disabled:opacity-50 ${
          error ? "border-red-500/60" : "border-border"
        }`}
        {...input}
      />
      {error ? (
        <p id={`${name}-error`} className="text-xs text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${name}-hint`} className="text-xs text-muted/70">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
