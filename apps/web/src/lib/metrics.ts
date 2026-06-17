import { PIPELINE_STATUSES } from '@/types';
import type { Application, ApplicationStatus, ResumeVersion } from '@/types';

export const SCREENING_PLUS: ApplicationStatus[] = [
  'screening',
  'online_assessment',
  'phone_interview',
  'technical_interview',
  'onsite',
  'offer',
  'accepted',
];

export const STALE_DAYS = 14;

export function countByStatus(apps: Application[]): Map<ApplicationStatus, number> {
  const m = new Map<ApplicationStatus, number>();
  for (const app of apps) {
    m.set(app.status, (m.get(app.status) ?? 0) + 1);
  }
  return m;
}

export function avgTimeInStage(apps: Application[], status: ApplicationStatus): number | null {
  const bucket = apps.filter(a => a.status === status && a.appliedAt && a.lastActivityAt);
  if (bucket.length === 0) return null;
  const totalDays = bucket.reduce(
    (sum, a) => sum + (new Date(a.lastActivityAt).getTime() - new Date(a.appliedAt).getTime()) / 86400000,
    0,
  );
  return Math.round(totalDays / bucket.length);
}

export interface DashboardMetrics {
  total: number;
  active: number;
  stale: number;
  responseRate: number;
  screeningPlusCount: number;
  byStatus: Map<ApplicationStatus, number>;
}

export function computeMetrics(apps: Application[], nowMs = Date.now()): DashboardMetrics {
  const byStatus = countByStatus(apps);
  const total = apps.length;
  const active = PIPELINE_STATUSES.reduce((s, st) => s + (byStatus.get(st) ?? 0), 0);
  const staleMs = STALE_DAYS * 86400 * 1000;
  const stale = apps.filter(
    a => PIPELINE_STATUSES.includes(a.status) && nowMs - new Date(a.lastActivityAt).getTime() > staleMs,
  ).length;
  const screeningPlusCount = apps.filter(a => SCREENING_PLUS.includes(a.status)).length;
  const responseRate = total > 0 ? Math.round((screeningPlusCount / total) * 100) : 0;
  return { total, active, stale, responseRate, screeningPlusCount, byStatus };
}

export interface ResumeRow extends ResumeVersion {
  usingCount: number;
  advancedCount: number;
  rate: number | null;
}

export function computeResumeRows(resumes: ResumeVersion[], apps: Application[]): ResumeRow[] {
  return resumes.map(r => {
    const using = apps.filter(a => a.resumeVersionId === r.versionId);
    const advanced = using.filter(a => SCREENING_PLUS.includes(a.status));
    const rate = using.length > 0 ? Math.round((advanced.length / using.length) * 100) : null;
    return { ...r, usingCount: using.length, advancedCount: advanced.length, rate };
  });
}

// ============================================================================
// Funnel, time-to-response, and statistical-significance analytics.
// These consume the append-only `statusHistory` log so the funnel reflects the
// furthest stage each application actually reached — not just its current status
// (a rejected app could have been rejected after `applied` or after `onsite`).
// ============================================================================

const SCREENING_IDX = PIPELINE_STATUSES.indexOf('screening');

/** Pipeline-stage indices of an app's transitions, in order; terminal/non-pipeline statuses skipped. */
function pipelineIndices(app: Application): number[] {
  const statuses = app.statusHistory?.length ? app.statusHistory.map(e => e.status) : [app.status];
  return statuses.map(s => PIPELINE_STATUSES.indexOf(s)).filter(i => i >= 0);
}

/**
 * The furthest pipeline stage an application has reached, treating a backward
 * move as a correction rather than a regression: if a stage was entered by
 * mistake and the status is later moved back down, that higher stage no longer
 * counts. Concretely this resolves to the last *pipeline* stage on record —
 * terminal statuses (rejected/withdrawn/ghosted) are skipped, so a
 * rejected-after-onsite app still resolves to `onsite`, while an app advanced to
 * `technical_interview` by mistake and corrected back to `screening` resolves to
 * `screening`. Floors at `applied`, since every application has at least applied.
 */
export function maxStageReached(app: Application): ApplicationStatus {
  const idxs = pipelineIndices(app);
  const reached = idxs.length ? idxs[idxs.length - 1] : 0;
  return PIPELINE_STATUSES[reached];
}

export interface Interval {
  point: number; // observed proportion
  low: number;
  high: number;
}

/** Threshold below which a proportion is too noisy to trust — show "need more data". */
export const NEED_MORE_DATA_N = 10;

export function hasEnoughData(n: number): boolean {
  return n >= NEED_MORE_DATA_N;
}

/**
 * Wilson score confidence interval for a binomial proportion (default 95%, z=1.96).
 * More honest than the normal approximation at the small n typical of a personal
 * job search: it stays within [0, 1] and doesn't collapse to a zero-width
 * interval at p=0 or p=1.
 */
export function wilsonInterval(successes: number, n: number, z = 1.96): Interval {
  if (n === 0) return { point: 0, low: 0, high: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    point: p,
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

export interface FunnelStage {
  status: ApplicationStatus;
  reached: number;
  rate: number; // 0–1, relative to n (the `applied` base)
  ci: Interval;
}

export interface StageConversion {
  from: ApplicationStatus;
  to: ApplicationStatus;
  reachedFrom: number;
  reachedTo: number;
  conversion: number; // 0–1, reachedTo / reachedFrom
  ci: Interval;
}

export interface Funnel {
  n: number;
  stages: FunnelStage[];
  conversions: StageConversion[];
}

/** Per-pipeline-stage reach counts (monotonic) + adjacent-stage conversions. */
export function computeFunnel(apps: Application[]): Funnel {
  const n = apps.length;
  const reachedIdx = apps.map(a => PIPELINE_STATUSES.indexOf(maxStageReached(a)));

  const stages: FunnelStage[] = PIPELINE_STATUSES.map((status, i) => {
    const reached = reachedIdx.filter(idx => idx >= i).length;
    return { status, reached, rate: n ? reached / n : 0, ci: wilsonInterval(reached, n) };
  });

  const conversions: StageConversion[] = [];
  for (let i = 0; i < stages.length - 1; i++) {
    const reachedFrom = stages[i].reached;
    const reachedTo = stages[i + 1].reached;
    conversions.push({
      from: stages[i].status,
      to: stages[i + 1].status,
      reachedFrom,
      reachedTo,
      conversion: reachedFrom ? reachedTo / reachedFrom : 0,
      ci: wilsonInterval(reachedTo, reachedFrom),
    });
  }

  return { n, stages, conversions };
}

export interface VariantFunnel extends Funnel {
  versionId: string;
  label: string;
}

export function funnelByVariant(apps: Application[], resumes: ResumeVersion[]): VariantFunnel[] {
  return resumes.map(r => {
    const using = apps.filter(a => a.resumeVersionId === r.versionId);
    return { versionId: r.versionId, label: r.label, ...computeFunnel(using) };
  });
}

/**
 * Whole days from `appliedAt` to the first time the app reached `screening+`.
 * Returns null if it never got a response. Falls back to `lastActivityAt` for
 * apps that have no history but are currently in a screening+ status.
 */
export function timeToFirstResponse(app: Application): number | null {
  const appliedMs = new Date(app.appliedAt).getTime();
  if (app.statusHistory?.length) {
    // Earliest screening+ event, but a later backward move *below* screening
    // (back to `applied`) invalidates an earlier response as a mis-classification.
    // A backward move that stays within screening+ (e.g. technical → screening)
    // does not — the app genuinely responded; only a higher stage was corrected.
    let firstMs: number | null = null;
    for (const e of app.statusHistory) {
      const idx = PIPELINE_STATUSES.indexOf(e.status);
      if (SCREENING_PLUS.includes(e.status)) {
        if (firstMs === null) firstMs = new Date(e.at).getTime();
      } else if (idx >= 0 && idx < SCREENING_IDX) {
        firstMs = null; // dropped below screening → the earlier response was a mistake
      }
    }
    if (firstMs === null) return null;
    return Math.round((firstMs - appliedMs) / 86400000);
  }
  if (SCREENING_PLUS.includes(app.status)) {
    return Math.round((new Date(app.lastActivityAt).getTime() - appliedMs) / 86400000);
  }
  return null;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface ResponseTimeRow {
  versionId: string;
  label: string;
  respondedCount: number;
  avgDays: number | null;
  medianDays: number | null;
}

export function responseTimesByVariant(apps: Application[], resumes: ResumeVersion[]): ResponseTimeRow[] {
  return resumes.map(r => {
    const using = apps.filter(a => a.resumeVersionId === r.versionId);
    const times = using.map(timeToFirstResponse).filter((t): t is number => t !== null);
    return {
      versionId: r.versionId,
      label: r.label,
      respondedCount: times.length,
      avgDays: times.length ? Math.round(mean(times)) : null,
      medianDays: times.length ? Math.round(median(times)) : null,
    };
  });
}

export interface VelocityBucket {
  weekStart: string; // YYYY-MM-DD (Monday, UTC)
  applied: number;
  responded: number; // reached screening+
  responseRate: number; // 0–1
}

function weekStart(iso: string): string {
  const d = new Date(iso);
  const dow = (d.getUTCDay() + 6) % 7; // shift so Monday = 0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow));
  return monday.toISOString().slice(0, 10);
}

/** Applications-per-week with the share that reached screening+, sorted oldest → newest. */
export function velocityOverTime(apps: Application[]): VelocityBucket[] {
  const buckets = new Map<string, { applied: number; responded: number }>();
  for (const a of apps) {
    const wk = weekStart(a.appliedAt);
    const b = buckets.get(wk) ?? { applied: 0, responded: 0 };
    b.applied++;
    if (PIPELINE_STATUSES.indexOf(maxStageReached(a)) >= SCREENING_IDX) b.responded++;
    buckets.set(wk, b);
  }
  return [...buckets.entries()]
    .map(([wk, v]) => ({
      weekStart: wk,
      applied: v.applied,
      responded: v.responded,
      responseRate: v.applied ? v.responded / v.applied : 0,
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}
