import type { Application } from '@/types';

/**
 * Case-insensitive substring search over company, role, and notes. An empty/whitespace
 * query returns the list unchanged. Client-side over the already-loaded application list.
 */
export function searchApplications(apps: Application[], query: string): Application[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return apps;
  return apps.filter(app => {
    const haystack = [app.company, app.role, app.notes ?? ''].join(' ').toLocaleLowerCase();
    return haystack.includes(q);
  });
}
