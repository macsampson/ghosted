import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useApplications,
  useApplication,
  useCreateApplication,
  useUpdateApplication,
  useDeleteApplication,
} from '@/hooks/useApplications';
import { createTestQueryClient, queryWrapper, makeApp } from '../test-utils';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));

beforeEach(() => vi.clearAllMocks());

describe('useApplications', () => {
  it('fetches the applications list', async () => {
    const apps = [makeApp(), makeApp()];
    get.mockResolvedValue(apps);
    const { result } = renderHook(() => useApplications(), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/applications');
    expect(result.current.data).toEqual(apps);
  });
});

describe('useApplication', () => {
  it('fetches a single application by id', async () => {
    const app = makeApp();
    get.mockResolvedValue(app);
    const { result } = renderHook(() => useApplication(app.appId), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith(`/applications/${app.appId}`);
  });

  it('is disabled when no appId is provided', () => {
    const { result } = renderHook(() => useApplication(''), { wrapper: queryWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('useCreateApplication', () => {
  it('posts the payload and invalidates the list', async () => {
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    post.mockResolvedValue(makeApp());
    const { result } = renderHook(() => useCreateApplication(), { wrapper: queryWrapper(client) });

    await result.current.mutateAsync({ company: 'Acme', role: 'Dev' });
    expect(post).toHaveBeenCalledWith('/applications', { company: 'Acme', role: 'Dev' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['applications'] });
  });
});

describe('useUpdateApplication', () => {
  it('puts to the app endpoint and invalidates both list and detail', async () => {
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    put.mockResolvedValue(makeApp());
    const { result } = renderHook(() => useUpdateApplication(), { wrapper: queryWrapper(client) });

    await result.current.mutateAsync({ appId: 'a1', status: 'screening' });
    expect(put).toHaveBeenCalledWith('/applications/a1', { status: 'screening' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['applications'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['applications', 'a1'] });
  });
});

describe('useDeleteApplication', () => {
  it('deletes by id and invalidates the list', async () => {
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    del.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteApplication(), { wrapper: queryWrapper(client) });

    await result.current.mutateAsync('a1');
    expect(del).toHaveBeenCalledWith('/applications/a1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['applications'] });
  });
});
