interface AssistantAvatarProps {
  size?: "sm" | "md";
}

const sizeClasses = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-xs",
} as const;

export function AssistantAvatar({ size = "sm" }: AssistantAvatarProps) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-lg bg-accent font-semibold text-accent-foreground shadow-[0_0_20px_-6px_var(--color-accent)] ${sizeClasses[size]}`}
    >
      LF
    </span>
  );
}
