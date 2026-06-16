import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, ApiError, isPlanLimitError } from '@/lib/api';

// getIdToken is the only collaborator; stub it so api just exercises fetch.
vi.mock('@/lib/auth', () => ({
  getIdToken: vi.fn().mockResolvedValue('test-token'),
}));

function mockFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = init;
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api request methods', () => {
  it('GET sends the auth header and parses JSON', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ ok: 1 }));
    const result = await api.get<{ ok: number }>('/things');

    expect(result).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/things');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('test-token');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    // GET has no body
    expect(init.body).toBeUndefined();
  });

  it('POST serializes the body to JSON', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ created: true }));
    await api.post('/things', { name: 'x' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'x' }));
  });

  it('PUT serializes the body and uses the PUT method', async () => {
    const fetchMock = mockFetch(() => jsonResponse({}));
    await api.put('/things/1', { name: 'y' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ name: 'y' }));
  });

  it('DELETE uses the DELETE method with no body', async () => {
    const fetchMock = mockFetch(() => jsonResponse({}));
    await api.delete('/things/1');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  it('throws the server-provided error message on a non-ok response', async () => {
    mockFetch(() => jsonResponse({ error: 'Not allowed' }, { ok: false, status: 403 }));
    await expect(api.get('/nope')).rejects.toThrow('Not allowed');
  });

  it('falls back to statusText when the error body has no error field', async () => {
    mockFetch(() => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response));
    await expect(api.get('/boom')).rejects.toThrow('Internal Server Error');
  });

  it('throws a generic message when error body parses but has no usable fields', async () => {
    mockFetch(() => jsonResponse({}, { ok: false, status: 400 }));
    await expect(api.get('/weird')).rejects.toThrow('Request failed');
  });

  it('throws an ApiError carrying the status and code', async () => {
    mockFetch(() => jsonResponse({ error: 'Upgrade', code: 'plan_limit' }, { ok: false, status: 402 }));
    await expect(api.get('/limited')).rejects.toMatchObject({ status: 402, code: 'plan_limit' });
  });
});

describe('isPlanLimitError', () => {
  it('is true only for a plan_limit ApiError', () => {
    expect(isPlanLimitError(new ApiError('x', 402, 'plan_limit'))).toBe(true);
    expect(isPlanLimitError(new ApiError('x', 400, 'bad'))).toBe(false);
    expect(isPlanLimitError(new Error('plain'))).toBe(false);
    expect(isPlanLimitError(null)).toBe(false);
  });
});
