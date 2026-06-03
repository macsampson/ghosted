import { PIPELINE_STATUSES } from '@/types';
import type { Application, ApplicationStatus, ResumeVersion } from '@/types';

export const SCREENING_PLUS: ApplicationStatus[] = [
  'screening',
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
