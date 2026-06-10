import { Play } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MediaFrameProps {
  /** Short label describing what this slot will show (e.g. "Pipeline kanban"). */
  label: string;
  /** Optional media source. When set, renders the real asset instead of the placeholder. */
  src?: string;
  /** Poster image shown before a video plays. */
  poster?: string;
  /** Treat `src` as a still image rather than a video. */
  image?: boolean;
  /** Tailwind aspect-ratio class. Defaults to a 16:9 frame. */
  aspect?: string;
  className?: string;
}

/**
 * A browser-chrome framed media slot for the landing page. Renders a labelled
 * placeholder until a real GIF/video is dropped in via `src` — swapping in the
 * recorded demos later is then a one-prop change per slot.
 */
export function MediaFrame({
  label,
  src,
  poster,
  image = false,
  aspect = 'aspect-video',
  className,
}: MediaFrameProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900 shadow-2xl shadow-black/30 ring-1 ring-white/5',
        className,
      )}
    >
      {/* Fake browser chrome */}
      <div className="flex items-center gap-1.5 border-b border-slate-700/60 bg-slate-800/80 px-4 py-2.5">
        <span className="h-3 w-3 rounded-full bg-red-400/80" />
        <span className="h-3 w-3 rounded-full bg-yellow-400/80" />
        <span className="h-3 w-3 rounded-full bg-green-400/80" />
        <span className="ml-3 truncate text-xs text-slate-400">ghosted.macsampson.com</span>
      </div>

      <div className={cn('relative w-full bg-slate-950', aspect)}>
        {src ? (
          image ? (
            <img src={src} alt={label} className="h-full w-full object-cover" />
          ) : (
            <video
              className="h-full w-full object-cover"
              src={src}
              poster={poster}
              autoPlay
              muted
              loop
              playsInline
            />
          )
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 ring-1 ring-slate-700">
              <Play className="h-5 w-5 translate-x-0.5" />
            </span>
            <span className="text-sm font-medium text-slate-400">{label}</span>
            <span className="text-xs text-slate-600">Demo coming soon</span>
          </div>
        )}
      </div>
    </div>
  );
}
