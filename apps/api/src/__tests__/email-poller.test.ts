import { describe, it, expect } from 'vitest';
import { normalizeWindow } from '../handlers/email-poller';

// normalizeWindow validates the Gmail `newer_than:` lookback used for backfills.
// It must default to the normal 12h poll window and reject anything that isn't a
// safe `<number><unit>` token, since the value is interpolated into the Gmail query.
describe('normalizeWindow', () => {
  it('defaults to 12h when no window is given', () => {
    expect(normalizeWindow()).toBe('12h');
  });

  it('defaults to 12h for an empty string', () => {
    expect(normalizeWindow('')).toBe('12h');
  });

  it.each(['1h', '12h', '48h', '3d', '7d', '1m', '1y'])(
    'accepts a valid window %s',
    (win) => {
      expect(normalizeWindow(win)).toBe(win);
    },
  );

  it.each(['abc', '3', 'd', '3w', '-1d', '3 d', '3.5d', 'newer_than:3d', '3d -in:sent'])(
    'rejects invalid window %s',
    (win) => {
      expect(() => normalizeWindow(win)).toThrow(/invalid poll window/i);
    },
  );
});
