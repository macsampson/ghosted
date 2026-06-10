import { Ghost } from 'lucide-react';

/** Footer with attribution + a placeholder link to the upcoming technical write-up. */
export function LandingFooter() {
  return (
    <footer className="bg-slate-950 py-12 text-slate-400">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 sm:px-6 md:flex-row md:justify-between">
        <div className="flex items-center gap-2 text-white">
          <Ghost className="h-5 w-5 text-primary" />
          <span className="font-semibold tracking-tight">ghosted</span>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
          <a
            href="https://github.com/macsampson"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-white"
          >
            GitHub
          </a>
          {/* TODO: point at the published technical write-up / blog post. */}
          <a href="#top" className="transition-colors hover:text-white">
            Read the technical write-up
          </a>
          <a
            href="https://macsampson.com"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-white"
          >
            macsampson.com
          </a>
        </nav>
      </div>

      <p className="mt-8 text-center text-xs text-slate-600">
        Built by Mac Sampson · ghosted.macsampson.com
      </p>
    </footer>
  );
}
