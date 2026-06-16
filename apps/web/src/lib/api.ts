import { getIdToken } from './auth';

const BASE_URL = import.meta.env.VITE_API_URL;

/** Carries the HTTP status + optional machine-readable `code` (e.g. `plan_limit`). */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/** True when an error is a free-plan limit (402) — drives the upgrade nudge. */
export function isPlanLimitError(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === 'plan_limit';
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getIdToken();
  return { Authorization: token, 'Content-Type': 'application/json' };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(err.error ?? 'Request failed', res.status, err.code);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
