import { describe, it, expect } from 'vitest';
import { filterApplications, ACTIVE_STATUSES } from '@/lib/applicationFilter';
import { PIPELINE_STATUSES, TERMINAL_STATUSES, type Application, type ApplicationStatus } from '@/types';

function makeApp(status: ApplicationStatus): Application {
  const now = new Date().toISOString();
  return {
    appId: crypto.randomUUID(),
    company: 'Acme',
    role: 'Engineer',
    status,
    appliedAt: now,
    lastActivityAt: now,
  };
}

const ALL_STATUSES: ApplicationStatus[] = [...PIPELINE_STATUSES, ...TERMINAL_STATUSES];

// ---------- ACTIVE_STATUSES set ----------

describe('ACTIVE_STATUSES', () => {
  it('excludes rejected, ghosted, and withdrawn', () => {
    expect(ACTIVE_STATUSES.has('rejected')).toBe(false);
    expect(ACTIVE_STATUSES.has('ghosted')).toBe(false);
    expect(ACTIVE_STATUSES.has('withdrawn')).toBe(false);
  });

  it('includes all pipeline statuses', () => {
    for (const s of PIPELINE_STATUSES) {
      expect(ACTIVE_STATUSES.has(s)).toBe(true);
    }
  });

  it('includes accepted', () => {
    expect(ACTIVE_STATUSES.has('accepted')).toBe(true);
  });
});

// ---------- filterApplications ----------

describe('filterApplications', () => {
  const apps = ALL_STATUSES.map(makeApp);

  it('"all" returns every application', () => {
    expect(filterApplications(apps, 'all')).toHaveLength(apps.length);
  });

  it('"active" excludes rejected, ghosted, and withdrawn', () => {
    const result = filterApplications(apps, 'active');
    expect(result.some(a => a.status === 'rejected')).toBe(false);
    expect(result.some(a => a.status === 'ghosted')).toBe(false);
    expect(result.some(a => a.status === 'withdrawn')).toBe(false);
  });

  it('"active" includes all pipeline statuses', () => {
    const result = filterApplications(apps, 'active');
    for (const s of PIPELINE_STATUSES) {
      expect(result.some(a => a.status === s)).toBe(true);
    }
  });

  it('"active" includes accepted', () => {
    const result = filterApplications(apps, 'active');
    expect(result.some(a => a.status === 'accepted')).toBe(true);
  });

  it('specific status returns only that status', () => {
    const result = filterApplications(apps, 'screening');
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('screening');
  });

  it('returns empty array when no apps match the specific status', () => {
    const onlyApplied = [makeApp('applied'), makeApp('applied')];
    expect(filterApplications(onlyApplied, 'rejected')).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(filterApplications([], 'active')).toHaveLength(0);
    expect(filterApplications([], 'all')).toHaveLength(0);
    expect(filterApplications([], 'applied')).toHaveLength(0);
  });
});
