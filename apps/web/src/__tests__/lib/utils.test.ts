import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

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
