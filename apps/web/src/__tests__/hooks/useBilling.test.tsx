import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useStartCheckout, useOpenPortal } from '@/hooks/useBilling';
import { queryWrapper } from '../test-utils';

const post = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { post: (...a: unknown[]) => post(...a) },
}));

const hrefSetter = vi.fn<(v: string) => void>();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { set href(v: string) { hrefSetter(v); } },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useStartCheckout', () => {
  it('posts to /billing/checkout and redirects to the returned url', async () => {
    post.mockResolvedValue({ url: 'https://checkout.stripe.test/abc' });
    const { result } = renderHook(() => useStartCheckout(), { wrapper: queryWrapper() });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(post).toHaveBeenCalledWith('/billing/checkout', {});
    expect(hrefSetter).toHaveBeenCalledWith('https://checkout.stripe.test/abc');
  });
});

describe('useOpenPortal', () => {
  it('posts to /billing/portal and redirects to the returned url', async () => {
    post.mockResolvedValue({ url: 'https://portal.stripe.test/xyz' });
    const { result } = renderHook(() => useOpenPortal(), { wrapper: queryWrapper() });

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(post).toHaveBeenCalledWith('/billing/portal', {});
    expect(hrefSetter).toHaveBeenCalledWith('https://portal.stripe.test/xyz');
  });
});
