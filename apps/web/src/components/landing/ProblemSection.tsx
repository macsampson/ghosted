const pains = [
  '50+ applications spread across spreadsheets, emails, and memory',
  '4 different resume variants and no idea which one actually lands callbacks',
  'Replies trickle in over weeks — and the ones that need a follow-up slip through',
  'No signal on which applications have quietly gone cold',
];

/** Frames the problem before the feature tour. Light section, theme tokens. */
export function ProblemSection() {
  return (
    <section className="border-b border-border bg-background py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">The problem</p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          Job searching at scale gets messy fast.
        </h2>
        <p className="mt-4 text-lg text-muted-foreground">
          When you&apos;re applying everywhere, the admin becomes its own full-time job:
        </p>

        <ul className="mx-auto mt-10 grid max-w-2xl gap-3 text-left sm:grid-cols-2">
          {pains.map((p) => (
            <li
              key={p}
              className="rounded-lg border border-border bg-card p-4 text-sm text-card-foreground"
            >
              {p}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
