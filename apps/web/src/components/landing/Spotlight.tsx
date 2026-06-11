import { Check } from 'lucide-react';
import { MediaFrame } from './MediaFrame';

const points = [
  'Reads new mail through a read-only Gmail connection',
  'Classifies each reply: rejection, interview request, offer, or follow-up needed',
  'Auto-updates the matching application — only when it is confident',
  'Low-confidence matches go to a review queue so you stay in control',
];

/** Dark band spotlighting the marquee AI email pipeline, with a large media slot. */
export function Spotlight() {
  return (
    <section className="bg-gradient-to-b from-slate-900 to-slate-950 py-20 text-white sm:py-28">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            Your inbox, on autopilot
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            The recruiter replied. Your tracker already knows.
          </h2>
          <p className="mt-4 text-lg text-slate-300">
            Ghosted watches for responses so you don&apos;t have to babysit your inbox. When a
            company gets back to you, the application moves itself down the pipeline.
          </p>

          <ul className="mt-8 space-y-3">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-3 text-slate-200">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>

        <MediaFrame label="Email review" src="/screenshots/pipeline.png" image />
      </div>
    </section>
  );
}
