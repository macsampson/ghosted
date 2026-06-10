import { Sparkles, ArrowRight } from 'lucide-react';
import { CtaButton } from './CtaButton';
import { MediaFrame } from './MediaFrame';

/** Dark gradient hero. Colors are explicit (not theme tokens) so the dark look
 *  stays scoped to the landing page without touching global dark mode. */
export function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 pt-32 pb-20 text-white sm:pt-40 sm:pb-28"
    >
      {/* soft glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl"
      />

      <div className="relative mx-auto max-w-6xl px-4 text-center sm:px-6">
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800/60 px-4 py-1.5 text-xs font-medium text-slate-300">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          AI-powered job application tracker
        </span>

        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">
          <span className="block">Companies ghost.</span>
          <span className="block">Ghosted remembers.</span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-300 sm:text-xl">
          Ghosted tracks every application, links each to the resume you used, and watches your
          inbox so statuses update themselves. Know what&apos;s working — and never let a follow-up
          slip.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <CtaButton className="px-6 py-3 text-base">
            Get started with Google
            <ArrowRight className="h-4 w-4" />
          </CtaButton>
          <a
            href="#how-it-works"
            className="inline-flex items-center gap-2 rounded-lg px-6 py-3 text-base font-semibold text-slate-200 transition-colors hover:bg-white/10"
          >
            See how it works
          </a>
        </div>

        <p className="mt-4 text-xs text-slate-500">Free to use · Sign in with your Google account</p>

        <div className="mx-auto mt-14 max-w-5xl sm:mt-20">
          <MediaFrame label="Product walkthrough" />
        </div>
      </div>
    </section>
  );
}
