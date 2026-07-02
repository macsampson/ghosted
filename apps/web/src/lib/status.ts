import type { ApplicationStatus } from '@/types';

/**
 * Central source of truth for per-status color styling, tuned for the dark theme.
 * `badge` — background/text/border classes for pills (StatusBadge).
 * `bar`   — solid fill for funnel/progress bars.
 * `dot`   — solid fill for small status dots.
 * `text`  — foreground-only accent (e.g. terminal outcome counts).
 */
type StatusStyle = {
  badge: string;
  bar: string;
  dot: string;
  text: string;
};

export const STATUS_STYLES: Record<ApplicationStatus, StatusStyle> = {
  applied: {
    badge: 'bg-sky-500/15 text-sky-300 border-sky-500/25',
    bar: 'bg-sky-500',
    dot: 'bg-sky-400',
    text: 'text-sky-300',
  },
  screening: {
    badge: 'bg-violet-500/15 text-violet-300 border-violet-500/25',
    bar: 'bg-violet-500',
    dot: 'bg-violet-400',
    text: 'text-violet-300',
  },
  online_assessment: {
    badge: 'bg-teal-500/15 text-teal-300 border-teal-500/25',
    bar: 'bg-teal-500',
    dot: 'bg-teal-400',
    text: 'text-teal-300',
  },
  phone_interview: {
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
    bar: 'bg-amber-500',
    dot: 'bg-amber-400',
    text: 'text-amber-300',
  },
  technical_interview: {
    badge: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
    bar: 'bg-orange-500',
    dot: 'bg-orange-400',
    text: 'text-orange-300',
  },
  onsite: {
    badge: 'bg-pink-500/15 text-pink-300 border-pink-500/25',
    bar: 'bg-pink-500',
    dot: 'bg-pink-400',
    text: 'text-pink-300',
  },
  offer: {
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
    bar: 'bg-emerald-500',
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
  },
  accepted: {
    badge: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30',
    bar: 'bg-emerald-400',
    dot: 'bg-emerald-300',
    text: 'text-emerald-300',
  },
  rejected: {
    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
    bar: 'bg-rose-500',
    dot: 'bg-rose-400',
    text: 'text-rose-300',
  },
  withdrawn: {
    badge: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/25',
    bar: 'bg-zinc-500',
    dot: 'bg-zinc-400',
    text: 'text-zinc-400',
  },
  ghosted: {
    badge: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
    bar: 'bg-zinc-600',
    dot: 'bg-zinc-500',
    text: 'text-zinc-500',
  },
};
