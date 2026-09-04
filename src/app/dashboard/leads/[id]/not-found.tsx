import Link from "next/link";

export default function LeadNotFound() {
  return (
    <div className="rounded-xl border border-border bg-surface px-6 py-12 text-center">
      <p className="text-sm font-medium text-foreground">Lead not found</p>
      <p className="mt-1 text-xs text-muted">
        It may have been removed, or it belongs to another organization.
      </p>
      <Link
        href="/dashboard/leads"
        className="mt-4 inline-block rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
      >
        Back to leads
      </Link>
    </div>
  );
}
