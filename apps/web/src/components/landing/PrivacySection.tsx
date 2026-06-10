import { ShieldCheck, Lock, EyeOff } from 'lucide-react';

const guarantees = [
  {
    Icon: EyeOff,
    title: 'Read-only Gmail access',
    body: 'Ghosted only reads messages to detect responses. It never sends, deletes, or modifies your mail.',
  },
  {
    Icon: Lock,
    title: 'Encrypted credentials',
    body: 'Your Gmail refresh token is encrypted with AES-256 before it is ever stored.',
  },
  {
    Icon: ShieldCheck,
    title: 'Your data stays yours',
    body: 'Single-tenant by design — your applications and emails are scoped to you and never shared.',
  },
];

/** Trust section — important because the product asks for inbox access. */
export function PrivacySection() {
  return (
    <section id="privacy" className="border-b border-border bg-secondary/40 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">Privacy</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Inbox access you can actually trust.
          </h2>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-3">
          {guarantees.map(({ Icon, title, body }) => (
            <div key={title} className="rounded-xl border border-border bg-card p-6 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
