import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useProfile,
  useStartGmailAuth,
  useEmails,
  useConfirmEmail,
  useDismissEmail,
} from '@/hooks/useEmails';
import { createTestQueryClient, queryWrapper, makeEmail } from '../test-utils';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
  },
}));

beforeEach(() => vi.clearAllMocks());

describe('useProfile', () => {
  it('fetches the profile', async () => {
    get.mockResolvedValue({ sub: 'u1', gmailConnected: false });
    const { result } = renderHook(() => useProfile(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/profile');
  });
});

describe('useEmails', () => {
  it('fetches all emails by default', async () => {
    get.mockResolvedValue([makeEmail()]);
    const { result } = renderHook(() => useEmails(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/emails');
  });

  it('appends the needsReview query param when requested', async () => {
    get.mockResolvedValue([]);
    const { result } = renderHook(() => useEmails(true), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/emails?needsReview=true');
  });
});

describe('useStartGmailAuth', () => {
  it('invalidates the profile when the server reports connected', async () => {
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    post.mockResolvedValue({ connected: true });
    const { result } = renderHook(() => useStartGmailAuth(), { wrapper: queryWrapper(client) });

    await result.current.mutateAsync();
    expect(post).toHaveBeenCalledWith('/auth/gmail/start', {});
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['profile'] });
  });

  it('redirects the browser when the server returns an authUrl', async () => {
    const original = window.location;
    // jsdom location is read-only; replace with a writable stub for the test.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: '' },
    });
    post.mockResolvedValue({ authUrl: 'https://accounts.google.com/o/oauth2' });
    const { result } = renderHook(() => useStartGmailAuth(), { wrapper: queryWrapper() });

    await result.current.mutateAsync();
    await waitFor(() => expect(window.location.href).toBe('https://accounts.google.com/o/oauth2'));

    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });
});

describe('useConfirmEmail', () => {
  it('confirms and invalidates emails + applications', async () => {
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    post.mockResolvedValue({ confirmed: true });
    const { result } = renderHook(() => useConfirmEmail(), { wrapper: queryWrapper(client) });

    await result.current.mutateAsync('msg-1');
    expect(post).toHaveBeenCalledWith('/emails/msg-1/confirm', {});
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['emails'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['applications'] });
  });
});

describe('useDismissEmail', () => {
  it('dismisses and invalidates emails', async () => {
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    post.mockResolvedValue({ dismissed: true });
    const { result } = renderHook(() => useDismissEmail(), { wrapper: queryWrapper(client) });

    await result.current.mutateAsync('msg-2');
    expect(post).toHaveBeenCalledWith('/emails/msg-2/dismiss', {});
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['emails'] });
  });
});
