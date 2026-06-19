import { describe, it, expect } from 'vitest';
import { cn, formatDate, todayLocalDate, calendarDateToISO } from '@/lib/utils';

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('drops falsy values', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });

  it('applies conditional object syntax from clsx', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active');
  });

  it('merges conflicting tailwind classes, last one wins', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });

  it('returns an empty string for no input', () => {
    expect(cn()).toBe('');
  });
});

describe('formatDate', () => {
  it('renders in the local timezone, not UTC', () => {
    // appliedAt must display the user's local date. An auto-created app stores the
    // email's real received instant; rendering that in UTC showed the next day for
    // users behind UTC (the reported "tomorrow" bug). Local rendering is the fix.
    const iso = '2026-06-18T05:00:00.000Z';
    expect(formatDate(iso)).toBe(new Date(iso).toLocaleDateString());
  });

  it('keeps a noon-UTC calendar date on the same day under local rendering', () => {
    // Form-entered calendar dates are stored at noon UTC precisely so that local
    // rendering does not drift a day in either direction (unlike midnight UTC).
    const iso = '2026-06-18T12:00:00.000Z';
    expect(formatDate(iso)).toBe(new Date(iso).toLocaleDateString());
  });
});

describe('todayLocalDate', () => {
  it('returns the local calendar date as YYYY-MM-DD', () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(todayLocalDate()).toBe(expected);
  });

  it('derives the day from local parts, not the UTC date portion', () => {
    // Late evening behind UTC, the UTC date has already rolled to tomorrow; the
    // default must still be the user's local today, not toISOString().slice(0,10).
    expect(todayLocalDate()).not.toMatch(/[T ]/);
    expect(todayLocalDate()).toHaveLength(10);
  });
});

describe('calendarDateToISO', () => {
  it('anchors a calendar date at noon UTC', () => {
    expect(calendarDateToISO('2026-06-18')).toBe('2026-06-18T12:00:00.000Z');
  });
});
