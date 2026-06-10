import {
  List,
  FileText,
  Mail,
  Columns,
  BarChart2,
  BellRing,
  type LucideIcon,
} from 'lucide-react';

interface Feature {
  Icon: LucideIcon;
  title: string;
  body: string;
  highlight?: boolean;
}

const features: Feature[] = [
  {
    Icon: List,
    title: 'One source of truth',
    body: 'Every application in one place — company, role, salary range, status, job link, and notes. No more scattered spreadsheets.',
  },
  {
    Icon: FileText,
    title: 'Resume versioning',
    body: 'Upload your resume variants, label them, and link each application to the exact version you sent.',
  },
  {
    Icon: Mail,
    title: 'AI inbox monitoring',
    body: 'Connect Gmail and AI reads incoming replies, classifying rejections, interview requests, and offers — then updates the status for you.',
    highlight: true,
  },
  {
    Icon: Columns,
    title: 'Pipeline board',
    body: 'Drag applications from Applied to Offer across a kanban board and see your entire funnel at a glance.',
  },
  {
    Icon: BarChart2,
    title: 'Resume analytics',
    body: 'See which resume variant actually earns the most callbacks, with response rates, confidence intervals, and stage-by-stage conversion.',
  },
  {
    Icon: BellRing,
    title: 'Stale alerts',
    body: 'A daily digest surfaces applications that have gone quiet for 14+ days, and auto-flags ones ghosted after 30.',
  },
];

/** Six-card feature overview. Light section using theme tokens. */
export function FeatureSection() {
  return (
    <section id="features" className="border-b border-border bg-secondary/40 py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">Features</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Everything you need to run your search like a system.
          </h2>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ Icon, title, body, highlight }) => (
            <div
              key={title}
              className="relative rounded-xl border border-border bg-card p-6 shadow-sm"
            >
              {highlight && (
                <span className="absolute right-4 top-4 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                  The headline feature
                </span>
              )}
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
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
