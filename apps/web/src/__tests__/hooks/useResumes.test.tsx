import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useResumes,
  useCreateResume,
  useResumeUrl,
  useDeleteResume,
} from '@/hooks/useResumes';
import { createTestQueryClient, queryWrapper, makeResume } from '../test-utils';

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

function pdfFile() {
  return new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' });
}

describe('useResumes', () => {
  it('fetches the resume list', async () => {
    get.mockResolvedValue([makeResume()]);
    const { result } = renderHook(() => useResumes(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/resumes');
  });
});

describe('useCreateResume', () => {
  it('gets a presigned URL then PUTs the file to storage', async () => {
    const resume = makeResume();
    post.mockResolvedValue({ resume, uploadUrl: 'https://s3.example/upload/abc' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCreateResume(), { wrapper: queryWrapper() });
    const file = pdfFile();
    const created = await result.current.mutateAsync({ label: 'v1', file });

    expect(post).toHaveBeenCalledWith('/resumes/upload-url', {
      label: 'v1',
      filename: 'cv.pdf',
      contentType: 'application/pdf',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://s3.example/upload/abc',
      expect.objectContaining({ method: 'PUT', body: file }),
    );
    expect(created).toEqual(resume);
  });

  it('skips the storage PUT for the mock-upload URL used in test mode', async () => {
    const resume = makeResume();
    post.mockResolvedValue({ resume, uploadUrl: 'http://local/mock-upload/abc' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCreateResume(), { wrapper: queryWrapper() });
    await result.current.mutateAsync({ label: 'v1', file: pdfFile() });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when the storage upload fails', async () => {
    post.mockResolvedValue({ resume: makeResume(), uploadUrl: 'https://s3.example/upload/abc' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response));

    const { result } = renderHook(() => useCreateResume(), { wrapper: queryWrapper() });
    await expect(result.current.mutateAsync({ label: 'v1', file: pdfFile() })).rejects.toThrow('Upload failed');
  });
});

describe('useResumeUrl', () => {
  it('requests a view URL', async () => {
    get.mockResolvedValue({ url: 'https://signed/view' });
    const { result } = renderHook(() => useResumeUrl(), { wrapper: queryWrapper() });
    await result.current.mutateAsync({ versionId: 'r1' });
    expect(get).toHaveBeenCalledWith('/resumes/r1/url');
  });

  it('requests a download URL when download is true', async () => {
    get.mockResolvedValue({ url: 'https://signed/dl' });
    const { result } = renderHook(() => useResumeUrl(), { wrapper: queryWrapper() });
    await result.current.mutateAsync({ versionId: 'r1', download: true });
    expect(get).toHaveBeenCalledWith('/resumes/r1/url?download=true');
  });
});

describe('useDeleteResume', () => {
  it('deletes by id and invalidates the list', async () => {
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    del.mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteResume(), { wrapper: queryWrapper(client) });

    await result.current.mutateAsync('r1');
    expect(del).toHaveBeenCalledWith('/resumes/r1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['resumes'] });
  });
});
