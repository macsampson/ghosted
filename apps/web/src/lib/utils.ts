import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a date/instant (e.g. `appliedAt`) for display in the user's local timezone.
 *
 * `appliedAt` mixes two kinds of value: form-entered calendar dates (stored at noon
 * UTC, which renders to the same calendar day in every realistic timezone) and real
 * instants from auto-created apps (the email's received time, which should show the
 * local day it arrived). Local formatting is correct for both — the noon-UTC anchor
 * is what keeps calendar dates from drifting a day under local rendering.
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

/** Today's date as `YYYY-MM-DD` in the user's local timezone (not UTC). */
export function todayLocalDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Converts a calendar date (`YYYY-MM-DD`, as produced by a date input) to an ISO
 * instant anchored at **noon UTC**. Noon rather than midnight so the value renders
 * to the same calendar day in every realistic timezone when displayed locally —
 * midnight UTC drifts to the previous day for users behind UTC.
 */
export function calendarDateToISO(date: string): string {
  return `${date}T12:00:00.000Z`;
}
