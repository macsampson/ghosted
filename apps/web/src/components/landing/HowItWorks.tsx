const steps = [
  {
    n: '1',
    title: 'Sign in with Google',
    body: 'Create your account in seconds with your Google login — no setup, no password to remember.',
  },
  {
    n: '2',
    title: 'Connect your inbox',
    body: 'Grant read-only Gmail access so Ghosted can watch for company replies and update statuses for you.',
  },
  {
    n: '3',
    title: 'Track and let it run',
    body: 'Log applications as you apply — or let Ghosted auto-create them from company replies — then watch the pipeline and analytics update themselves.',
  },
];

/** Three-step "how it works" walkthrough. Light section. */
export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-b border-border bg-background py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            How it works
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Set it up once. It works in the background.
          </h2>
        </div>

        <ol className="mt-14 grid gap-8 md:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n} className="relative">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
                {s.n}
              </span>
              <h3 className="mt-5 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
