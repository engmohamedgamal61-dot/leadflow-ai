const features = [
  {
    title: "Qualify instantly",
    description:
      "Score and prioritize every inbound lead automatically, so your team only talks to buyers who are ready.",
  },
  {
    title: "Automate the busywork",
    description:
      "Routing, follow-ups, and enrichment run on their own — your pipeline keeps moving without manual effort.",
  },
  {
    title: "Close with context",
    description:
      "Every conversation arrives with the signals that matter, giving reps a clear reason to reach out.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="h-6 w-6 rounded-md bg-accent shadow-[0_0_24px_-4px_var(--color-accent)]"
          />
          <span className="text-sm font-semibold tracking-tight">LeadFlow AI</span>
        </div>
        <span className="text-xs font-medium text-muted">Private beta</span>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-20">
        <div className="max-w-2xl">
          <p className="mb-5 inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
            AI-powered sales pipeline
          </p>
          <h1 className="text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
            AI-powered lead qualification and sales automation
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
            LeadFlow AI turns raw inbound interest into a ranked, ready-to-work
            pipeline — qualifying, enriching, and routing leads so your team
            spends its time selling.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <a
              href="#"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-accent px-6 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
            >
              Request access
            </a>
            <a
              href="#features"
              className="inline-flex h-11 items-center justify-center rounded-lg border border-border bg-surface px-6 text-sm font-medium text-foreground transition-colors hover:bg-border/40"
            >
              See how it works
            </a>
          </div>
        </div>

        <section
          id="features"
          className="mt-24 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3"
        >
          {features.map((feature) => (
            <div key={feature.title} className="bg-surface p-6">
              <h2 className="text-sm font-semibold tracking-tight">
                {feature.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {feature.description}
              </p>
            </div>
          ))}
        </section>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-6 py-8">
        <p className="text-xs text-muted">
          © {new Date().getFullYear()} LeadFlow AI. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
