/**
 * The dashboard intro: a large greeting keyed to the authenticated user, a
 * status subtitle, and a quiet brand line on the opposite side.
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
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-[28px] sm:leading-tight">
          {greeting}
        </h1>
        <p className="mt-1.5 text-[14px] text-muted">{subtitle}</p>
      </div>
      <div className="shrink-0 sm:max-w-[27rem] sm:text-end">
        <p className="text-[12.5px] leading-snug text-muted/80">
          &ldquo;{quote}&rdquo;
        </p>
        <p className="mt-0.5 text-[11px] text-muted/60">— {quoteAttribution}</p>
      </div>
    </div>
  );
}
