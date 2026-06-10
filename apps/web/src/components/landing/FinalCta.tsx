import { ArrowRight } from 'lucide-react';
import { CtaButton } from './CtaButton';

/** Closing call to action. Dark band to bookend the hero. */
export function FinalCta() {
  return (
    <section className="bg-gradient-to-b from-slate-950 to-slate-900 py-24 text-center text-white">
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Take control of your job search.
        </h2>
        <p className="mt-4 text-lg text-slate-300">
          Track every application, see what&apos;s working, and never get ghosted by your own
          inbox again.
        </p>
        <div className="mt-8 flex justify-center">
          <CtaButton className="px-6 py-3 text-base">
            Get started with Google
            <ArrowRight className="h-4 w-4" />
          </CtaButton>
        </div>
      </div>
    </section>
  );
}
