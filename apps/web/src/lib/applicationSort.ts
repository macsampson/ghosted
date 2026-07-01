import { PIPELINE_STATUSES, TERMINAL_STATUSES, type Application, type ApplicationStatus } from '@/types';

export type SortKey = 'company' | 'role' | 'status' | 'appliedAt' | 'lastActivityAt' | 'salary';
export type SortDir = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

// Pipeline progression, then terminal statuses — the natural order for a "Status" column
// (alphabetical would wedge `onsite` between `online_assessment` and `phone_interview`).
const STATUS_ORDER: Record<ApplicationStatus, number> = Object.fromEntries(
  [...PIPELINE_STATUSES, ...TERMINAL_STATUSES].map((s, i) => [s, i]),
) as Record<ApplicationStatus, number>;

/**
 * The list's resting order when no column is actively selected. Primary: last activity
 * (a real, server-set timestamp) descending. Secondary: applied date (day only), since the
 * appliedAt time component is unreliable (form-created apps store UTC noon, auto-created ones
 * store a real timestamp). Tie: newest-added first by createdAt, then appId for full stability.
 */
export function defaultCompare(a: Application, b: Application): number {
  const aAct = a.lastActivityAt ?? a.appliedAt ?? '';
  const bAct = b.lastActivityAt ?? b.appliedAt ?? '';
  if (aAct !== bAct) return bAct.localeCompare(aAct);
  const aDay = (a.appliedAt ?? '').slice(0, 10);
  const bDay = (b.appliedAt ?? '').slice(0, 10);
  if (aDay !== bDay) return bDay.localeCompare(aDay);
  const aCreated = a.createdAt ?? a.appliedAt ?? '';
  const bCreated = b.createdAt ?? b.appliedAt ?? '';
  if (aCreated !== bCreated) return bCreated.localeCompare(aCreated);
  return a.appId.localeCompare(b.appId);
}

export function defaultSort(apps: Application[]): Application[] {
  return apps.slice().sort(defaultCompare);
}

// Per-column comparator, always expressed as ascending. `null` means "no value" and always
// sorts to the bottom regardless of direction.
function columnValue(app: Application, key: SortKey): string | number | null {
  switch (key) {
    case 'company':
      return app.company.toLocaleLowerCase();
    case 'role':
      return app.role.toLocaleLowerCase();
    case 'status':
      return STATUS_ORDER[app.status];
    case 'appliedAt':
      return app.appliedAt ? app.appliedAt.slice(0, 10) : null;
    case 'lastActivityAt':
      return app.lastActivityAt ?? null;
    case 'salary':
      return app.salaryRange ? app.salaryRange.min : null;
  }
}

export function sortApplications(apps: Application[], sort: SortState | null): Application[] {
  if (!sort) return defaultSort(apps);
  const factor = sort.dir === 'asc' ? 1 : -1;
  return apps.slice().sort((a, b) => {
    const av = columnValue(a, sort.key);
    const bv = columnValue(b, sort.key);
    // Missing values always sink, independent of sort direction.
    if (av === null && bv === null) return defaultCompare(a, b);
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv));
    if (cmp !== 0) return cmp * factor;
    // Stable, deterministic tiebreak so equal-valued rows never jitter.
    return defaultCompare(a, b);
  });
}

/** Toggle helper for header clicks: first click on a column sorts ascending, second flips. */
export function nextSort(current: SortState | null, key: SortKey): SortState {
  if (current?.key === key) {
    return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key, dir: 'asc' };
}
