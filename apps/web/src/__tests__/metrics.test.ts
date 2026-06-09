import { describe, it, expect } from 'vitest';
import {
  computeMetrics,
  computeResumeRows,
  avgTimeInStage,
  countByStatus,
  maxStageReached,
  wilsonInterval,
  hasEnoughData,
  computeFunnel,
  funnelByVariant,
  timeToFirstResponse,
  responseTimesByVariant,
  velocityOverTime,
  NEED_MORE_DATA_N,
} from '@/lib/metrics';
import type { Application, ResumeVersion, StatusEvent } from '@/types';

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

// Build a statusHistory from [status, daysAgo] pairs (oldest first).
function history(...steps: [Application['status'], number][]): StatusEvent[] {
  return steps.map(([status, d]) => ({ status, at: daysAgo(d), source: 'manual' as const }));
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

// ---------- maxStageReached ----------

describe('maxStageReached', () => {
  it('falls back to current status when there is no history', () => {
    expect(maxStageReached(makeApp({ status: 'screening' }))).toBe('screening');
  });

  it('returns "applied" for a terminal app with no history (furthest pipeline stage unknown)', () => {
    expect(maxStageReached(makeApp({ status: 'rejected' }))).toBe('applied');
  });

  it('returns the furthest pipeline stage from history even after a terminal status', () => {
    const app = makeApp({
      status: 'rejected',
      statusHistory: history(['applied', 30], ['screening', 20], ['onsite', 10], ['rejected', 5]),
    });
    expect(maxStageReached(app)).toBe('onsite');
  });

  it('treats a backward move as a correction — a reverted advance no longer counts', () => {
    // Advanced to technical by mistake, then corrected back down to screening.
    const app = makeApp({
      status: 'screening',
      statusHistory: history(['applied', 10], ['technical_interview', 8], ['screening', 2]),
    });
    expect(maxStageReached(app)).toBe('screening');
  });

  it('keeps a stage that is re-reached after a correction', () => {
    const app = makeApp({
      status: 'onsite',
      statusHistory: history(['applied', 20], ['technical_interview', 15], ['screening', 10], ['onsite', 3]),
    });
    expect(maxStageReached(app)).toBe('onsite');
  });

  it('resets fully when corrected all the way back to applied', () => {
    const app = makeApp({
      status: 'applied',
      statusHistory: history(['applied', 10], ['screening', 8], ['applied', 2]),
    });
    expect(maxStageReached(app)).toBe('applied');
  });
});

// ---------- wilsonInterval ----------

describe('wilsonInterval', () => {
  it('returns a zeroed interval for n = 0', () => {
    expect(wilsonInterval(0, 0)).toEqual({ point: 0, low: 0, high: 0 });
  });

  it('is symmetric around 0.5 at p = 0.5', () => {
    const ci = wilsonInterval(5, 10);
    expect(ci.point).toBeCloseTo(0.5, 5);
    expect(ci.low).toBeCloseTo(0.2366, 3);
    expect(ci.high).toBeCloseTo(0.7634, 3);
  });

  it('clamps the upper bound at 1 and pulls the lower bound below 1 for p = 1', () => {
    const ci = wilsonInterval(10, 10);
    expect(ci.point).toBe(1);
    expect(ci.high).toBe(1);
    expect(ci.low).toBeCloseTo(0.7225, 3);
  });

  it('clamps the lower bound at 0 for p = 0', () => {
    const ci = wilsonInterval(0, 10);
    expect(ci.point).toBe(0);
    expect(ci.low).toBe(0);
    expect(ci.high).toBeCloseTo(0.2775, 3);
  });

  it('narrows the interval as n grows', () => {
    const small = wilsonInterval(1, 2); // 50% from 2 samples
    const large = wilsonInterval(50, 100); // 50% from 100 samples
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });
});

describe('hasEnoughData', () => {
  it('flags samples below the threshold', () => {
    expect(hasEnoughData(NEED_MORE_DATA_N - 1)).toBe(false);
    expect(hasEnoughData(NEED_MORE_DATA_N)).toBe(true);
  });
});

// ---------- computeFunnel / funnelByVariant ----------

describe('computeFunnel', () => {
  it('counts apps reaching each stage with monotonic fill', () => {
    const apps = [
      // reached onsite then rejected — counts at applied..onsite
      makeApp({ status: 'rejected', statusHistory: history(['applied', 30], ['onsite', 10], ['rejected', 5]) }),
      // currently screening — counts at applied, screening
      makeApp({ status: 'screening', statusHistory: history(['applied', 20], ['screening', 8]) }),
      // applied only
      makeApp({ status: 'applied', statusHistory: history(['applied', 15]) }),
    ];
    const f = computeFunnel(apps);
    expect(f.n).toBe(3);
    const reached = Object.fromEntries(f.stages.map(s => [s.status, s.reached]));
    expect(reached.applied).toBe(3);
    expect(reached.screening).toBe(2);
    expect(reached.phone_interview).toBe(1); // only the onsite app
    expect(reached.onsite).toBe(1);
    expect(reached.offer).toBe(0);
    // applied is always the 100% base
    expect(f.stages[0].rate).toBe(1);
  });

  it('derives adjacent-stage conversions', () => {
    const apps = [
      makeApp({ status: 'screening', statusHistory: history(['applied', 20], ['screening', 8]) }),
      makeApp({ status: 'applied', statusHistory: history(['applied', 15]) }),
    ];
    const f = computeFunnel(apps);
    const appliedToScreening = f.conversions.find(c => c.from === 'applied' && c.to === 'screening')!;
    expect(appliedToScreening.reachedFrom).toBe(2);
    expect(appliedToScreening.reachedTo).toBe(1);
    expect(appliedToScreening.conversion).toBe(0.5);
  });

  it('returns an empty-but-valid funnel for no apps', () => {
    const f = computeFunnel([]);
    expect(f.n).toBe(0);
    expect(f.stages.every(s => s.reached === 0 && s.rate === 0)).toBe(true);
  });
});

describe('funnelByVariant', () => {
  const resumes: ResumeVersion[] = [
    { versionId: 'A', label: 'Resume A', s3Key: 'a', uploadedAt: daysAgo(60), useCount: 0 },
    { versionId: 'B', label: 'Resume B', s3Key: 'b', uploadedAt: daysAgo(60), useCount: 0 },
  ];

  it('separates the funnel per resume variant', () => {
    const apps = [
      makeApp({ resumeVersionId: 'A', status: 'rejected', statusHistory: history(['applied', 30], ['screening', 20], ['rejected', 10]) }),
      makeApp({ resumeVersionId: 'A', status: 'applied', statusHistory: history(['applied', 25]) }),
      makeApp({ resumeVersionId: 'B', status: 'technical_interview', statusHistory: history(['applied', 20], ['technical_interview', 5]) }),
    ];
    const variants = funnelByVariant(apps, resumes);
    const a = variants.find(v => v.versionId === 'A')!;
    const b = variants.find(v => v.versionId === 'B')!;
    expect(a.n).toBe(2);
    expect(b.n).toBe(1);
    const aReached = Object.fromEntries(a.stages.map(s => [s.status, s.reached]));
    expect(aReached.screening).toBe(1);
    expect(aReached.technical_interview).toBe(0);
    const bReached = Object.fromEntries(b.stages.map(s => [s.status, s.reached]));
    expect(bReached.technical_interview).toBe(1);
  });
});

// ---------- timeToFirstResponse / responseTimesByVariant ----------

describe('timeToFirstResponse', () => {
  it('measures days from appliedAt to the first screening+ event', () => {
    const app = makeApp({
      status: 'screening',
      appliedAt: daysAgo(10),
      statusHistory: history(['applied', 10], ['screening', 7]),
    });
    expect(timeToFirstResponse(app)).toBe(3); // 10 - 7
  });

  it('returns null when the app never reached screening+', () => {
    const app = makeApp({ status: 'applied', statusHistory: history(['applied', 10]) });
    expect(timeToFirstResponse(app)).toBeNull();
  });

  it('uses the earliest screening+ event, not a later one', () => {
    const app = makeApp({
      status: 'onsite',
      appliedAt: daysAgo(20),
      statusHistory: history(['applied', 20], ['screening', 18], ['onsite', 5]),
    });
    expect(timeToFirstResponse(app)).toBe(2); // 20 - 18
  });

  it('keeps the early response when a higher stage is corrected (stays within screening+)', () => {
    // Genuinely responded at screening; a mistaken technical advance was reverted.
    const app = makeApp({
      status: 'screening',
      appliedAt: daysAgo(20),
      statusHistory: history(['applied', 20], ['screening', 17], ['technical_interview', 10], ['screening', 4]),
    });
    expect(timeToFirstResponse(app)).toBe(3); // 20 - 17, the genuine first response
  });

  it('invalidates a response that was corrected back below screening, using the real one', () => {
    // Mistakenly marked screening, corrected back to applied, then genuinely reached screening.
    const app = makeApp({
      status: 'screening',
      appliedAt: daysAgo(20),
      statusHistory: history(['applied', 20], ['screening', 18], ['applied', 16], ['screening', 6]),
    });
    expect(timeToFirstResponse(app)).toBe(14); // 20 - 6, not 20 - 18
  });

  it('returns null when a mistaken response was fully reverted to applied', () => {
    const app = makeApp({
      status: 'applied',
      appliedAt: daysAgo(20),
      statusHistory: history(['applied', 20], ['screening', 18], ['applied', 16]),
    });
    expect(timeToFirstResponse(app)).toBeNull();
  });

  // No-statusHistory fallback: estimate from lastActivityAt based on current status.
  it('estimates from lastActivityAt when there is no history and the status is screening+', () => {
    const app = makeApp({
      status: 'phone_interview',
      appliedAt: daysAgo(5),
      lastActivityAt: daysAgo(0),
      statusHistory: undefined,
    });
    expect(timeToFirstResponse(app)).toBe(5);
  });

  it('returns null when there is no history and the status is below screening', () => {
    const app = makeApp({ status: 'applied', statusHistory: undefined });
    expect(timeToFirstResponse(app)).toBeNull();
  });

  it('returns null for an empty statusHistory below screening', () => {
    const app = makeApp({ status: 'applied', statusHistory: [] });
    expect(timeToFirstResponse(app)).toBeNull();
  });
});

describe('responseTimesByVariant', () => {
  const resumes: ResumeVersion[] = [
    { versionId: 'A', label: 'Resume A', s3Key: 'a', uploadedAt: daysAgo(60), useCount: 0 },
  ];

  it('reports avg and median over responded apps only', () => {
    const apps = [
      makeApp({ resumeVersionId: 'A', status: 'screening', appliedAt: daysAgo(10), statusHistory: history(['applied', 10], ['screening', 8]) }), // 2
      makeApp({ resumeVersionId: 'A', status: 'screening', appliedAt: daysAgo(10), statusHistory: history(['applied', 10], ['screening', 6]) }), // 4
      makeApp({ resumeVersionId: 'A', status: 'screening', appliedAt: daysAgo(10), statusHistory: history(['applied', 10], ['screening', 4]) }), // 6
      makeApp({ resumeVersionId: 'A', status: 'applied', statusHistory: history(['applied', 5]) }), // no response — excluded
    ];
    const rows = responseTimesByVariant(apps, resumes);
    const a = rows.find(r => r.versionId === 'A')!;
    expect(a.respondedCount).toBe(3);
    expect(a.avgDays).toBe(4); // (2+4+6)/3
    expect(a.medianDays).toBe(4);
  });
});

// ---------- velocityOverTime ----------

describe('velocityOverTime', () => {
  it('buckets applications by week and computes a response rate', () => {
    const apps = [
      makeApp({ status: 'screening', appliedAt: daysAgo(2), statusHistory: history(['applied', 2], ['screening', 1]) }),
      makeApp({ status: 'applied', appliedAt: daysAgo(3), statusHistory: history(['applied', 3]) }),
      makeApp({ status: 'applied', appliedAt: daysAgo(20), statusHistory: history(['applied', 20]) }),
    ];
    const buckets = velocityOverTime(apps);
    // two distinct weeks
    expect(buckets.length).toBeGreaterThanOrEqual(2);
    const total = buckets.reduce((s, b) => s + b.applied, 0);
    expect(total).toBe(3);
    // buckets are sorted ascending by weekStart
    const sorted = [...buckets].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    expect(buckets.map(b => b.weekStart)).toEqual(sorted.map(b => b.weekStart));
  });

  it('returns an empty array for no apps', () => {
    expect(velocityOverTime([])).toEqual([]);
  });
});
