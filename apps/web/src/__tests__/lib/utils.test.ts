import { describe, it, expect } from 'vitest';
import { cn, formatDate } from '@/lib/utils';

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
  it('renders a UTC-midnight calendar date as that same day, not the day before', () => {
    // appliedAt is a calendar date stored as UTC midnight. Formatting it in local
    // time shifts it back a day in any behind-UTC timezone (the reported bug).
    // formatDate must format in UTC so the picked day round-trips everywhere.
    const iso = '2026-06-17T00:00:00.000Z';
    const expected = new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC' });
    expect(formatDate(iso)).toBe(expected);
  });

  it('is stable for a date whose UTC and local days differ', () => {
    // 23:30 UTC: in any positive-offset zone the local day is already the 18th,
    // in negative-offset zones it is still the 17th. Anchored to UTC, formatDate
    // always reports the 17th regardless of the runner's timezone.
    const iso = '2026-06-17T23:30:00.000Z';
    expect(formatDate(iso)).toBe(new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC' }));
  });
});
