/**
 * The dashboard intro: a large greeting keyed to the authenticated user, a
 * one-line status subtitle, and a quiet brand line on the opposite side. All
 * strings are built and localized by the page.
 */
export function GreetingHeader({
  greeting,
  subtitle,
  quote,
  quoteAttribution,
}: {
  greeting: string;
  subtitle: string;
  quote: string;
  quoteAttribution: string;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-[26px] sm:leading-tight">
          {greeting}
        </h1>
        <p className="mt-1 text-[13px] text-muted">{subtitle}</p>
      </div>
      <div className="max-w-[16rem] shrink-0 sm:text-end">
        <p className="text-[12px] italic leading-snug text-muted/70">
          &ldquo;{quote}&rdquo;
        </p>
        <p className="mt-0.5 text-[11px] text-muted/50">— {quoteAttribution}</p>
      </div>
    </div>
  );
}
