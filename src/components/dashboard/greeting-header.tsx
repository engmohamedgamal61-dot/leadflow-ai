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
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground sm:text-[26px] sm:leading-tight">
          {greeting}
        </h1>
        <p className="mt-1 text-[13.5px] text-muted">{subtitle}</p>
      </div>
      <div className="shrink-0 sm:max-w-[27rem] sm:pt-0.5 sm:text-end">
        <p className="text-[12px] leading-snug text-muted/80">
          &ldquo;{quote}&rdquo;
        </p>
        <p className="mt-0.5 text-[11px] text-muted/60">— {quoteAttribution}</p>
      </div>
    </div>
  );
}
