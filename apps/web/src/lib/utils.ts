import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a calendar date (e.g. `appliedAt`) for display. The value is stored as
 * UTC midnight, so it must be formatted in UTC — `toLocaleDateString()` without a
 * timezone converts to local time and shifts the date back a day for any user
 * behind UTC. The date the user picked round-trips in every timezone.
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC' });
}
