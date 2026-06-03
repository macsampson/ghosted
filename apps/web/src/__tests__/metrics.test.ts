import { describe, it, expect } from 'vitest';
import { computeMetrics, computeResumeRows, avgTimeInStage, countByStatus } from '@/lib/metrics';
import type { Application, ResumeVersion } from '@/types';

function makeApp(overrides: Partial<Application> = {}): Application {
  const now = new Date().toISOString();
  return {
    appId: crypto.randomUUID(),
    company: 'Acme',
    role: 'Engineer',
    status: 'applied',
    appliedAt: now,
    lastActivityAt: now,
    ...overrides,
  };
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400 * 1000).toISOString();
}

// ---------- countByStatus ----------

describe('countByStatus', () => {
  it('counts applications per status', () => {
    const apps = [
      makeApp({ status: 'applied' }),
      makeApp({ status: 'applied' }),
      makeApp({ status: 'screening' }),
    ];
    const counts = countByStatus(apps);
    expect(counts.get('applied')).toBe(2);
    expect(counts.get('screening')).toBe(1);
    expect(counts.get('rejected')).toBeUndefined();
  });

  it('returns an empty map for no applications', () => {
    expect(countByStatus([])).toEqual(new Map());
  });
});

// ---------- avgTimeInStage ----------

describe('avgTimeInStage', () => {
  it('returns null for an empty status bucket', () => {
    expect(avgTimeInStage([], 'applied')).toBeNull();
    expect(avgTimeInStage([makeApp({ status: 'screening' })], 'applied')).toBeNull();
  });

  it('calculates average days correctly', () => {
    const apps = [
      makeApp({ status: 'applied', appliedAt: daysAgo(10), lastActivityAt: daysAgo(0) }),
      makeApp({ status: 'applied', appliedAt: daysAgo(20), lastActivityAt: daysAgo(0) }),
    ];
    expect(avgTimeInStage(apps, 'applied')).toBe(15);
  });

  it('rounds to the nearest integer', () => {
    const apps = [
      makeApp({ status: 'screening', appliedAt: daysAgo(7), lastActivityAt: daysAgo(0) }),
      makeApp({ status: 'screening', appliedAt: daysAgo(8), lastActivityAt: daysAgo(0) }),
    ];
    expect(avgTimeInStage(apps, 'screening')).toBe(8); // (7+8)/2 = 7.5 → rounds to 8
  });
});

// ---------- computeMetrics ----------

describe('computeMetrics', () => {
  it('returns zeros for an empty application list', () => {
    const m = computeMetrics([]);
    expect(m.total).toBe(0);
    expect(m.active).toBe(0);
    expect(m.stale).toBe(0);
    expect(m.responseRate).toBe(0);
  });

  it('counts total and active correctly', () => {
    const apps = [
      makeApp({ status: 'applied' }),
      makeApp({ status: 'screening' }),
      makeApp({ status: 'rejected' }), // terminal — not active
    ];
    const m = computeMetrics(apps);
    expect(m.total).toBe(3);
    expect(m.active).toBe(2);
  });

  it('identifies stale applications (>14 days no activity, still in pipeline)', () => {
    const now = Date.now();
    const apps = [
      makeApp({ status: 'applied', lastActivityAt: daysAgo(15) }),   // stale
      makeApp({ status: 'applied', lastActivityAt: daysAgo(10) }),   // not stale
      makeApp({ status: 'rejected', lastActivityAt: daysAgo(20) }),  // terminal — not counted as stale
    ];
    const m = computeMetrics(apps, now);
    expect(m.stale).toBe(1);
  });

  it('calculates response rate as percentage of apps that reached screening+', () => {
    const apps = [
      makeApp({ status: 'applied' }),
      makeApp({ status: 'screening' }),
      makeApp({ status: 'phone_interview' }),
      makeApp({ status: 'rejected' }),
    ];
    // 2 of 4 reached screening+ → 50%
    const m = computeMetrics(apps);
    expect(m.responseRate).toBe(50);
  });

  it('response rate is 0 when no applications', () => {
    expect(computeMetrics([]).responseRate).toBe(0);
  });

  it('counts accepted as screening+', () => {
    const apps = [makeApp({ status: 'accepted' }), makeApp({ status: 'applied' })];
    const m = computeMetrics(apps);
    expect(m.responseRate).toBe(50);
  });
});

// ---------- computeResumeRows ----------

describe('computeResumeRows', () => {
  const resume: ResumeVersion = {
    versionId: 'rv-1',
    label: 'SWE Resume v1',
    s3Key: 'user/rv-1/resume.pdf',
    uploadedAt: new Date().toISOString(),
    useCount: 2,
  };

  it('returns rate: null when no applications use the resume', () => {
    const rows = computeResumeRows([resume], [makeApp()]);
    expect(rows[0].usingCount).toBe(0);
    expect(rows[0].rate).toBeNull();
  });

  it('calculates response rate for resume correctly', () => {
    const apps = [
      makeApp({ resumeVersionId: 'rv-1', status: 'applied' }),
      makeApp({ resumeVersionId: 'rv-1', status: 'screening' }),
      makeApp({ resumeVersionId: 'rv-1', status: 'rejected' }),
    ];
    const rows = computeResumeRows([resume], apps);
    expect(rows[0].usingCount).toBe(3);
    expect(rows[0].advancedCount).toBe(1);
    expect(rows[0].rate).toBe(33); // 1/3 = 33%
  });

  it('100% rate when all applications advanced past screening', () => {
    const apps = [
      makeApp({ resumeVersionId: 'rv-1', status: 'offer' }),
      makeApp({ resumeVersionId: 'rv-1', status: 'accepted' }),
    ];
    const rows = computeResumeRows([resume], apps);
    expect(rows[0].rate).toBe(100);
  });
});
