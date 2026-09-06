/**
 * The dashboard intro: a large greeting keyed to the authenticated user, a
 * one-line status subtitle, and a quiet brand line on the opposite side. All
 * three strings are built and localized by the page.
 */
export function GreetingHeader({
  greeting,
  subtitle,
  quote,
}: {
  greeting: string;
  subtitle: string;
  quote: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
          {greeting}
        </h1>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </div>
      <p className="max-w-xs text-xs leading-relaxed text-muted/70 sm:text-end">
        {quote}
      </p>
    </div>
  );
}
