import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useApplications } from '@/hooks/useApplications';
import { useResumes } from '@/hooks/useResumes';
import { computeMetrics, computeResumeRows, avgTimeInStage, SCREENING_PLUS } from '@/lib/metrics';
import {
  PIPELINE_STATUSES,
  TERMINAL_STATUSES,
  STATUS_LABELS,
  type ApplicationStatus,
} from '@/types';

// ---------- constants ----------

const BAR_COLORS: Record<ApplicationStatus, string> = {
  applied: 'bg-blue-400',
  screening: 'bg-purple-400',
  phone_interview: 'bg-yellow-400',
  technical_interview: 'bg-orange-400',
  onsite: 'bg-pink-400',
  offer: 'bg-green-400',
  accepted: 'bg-green-500',
  rejected: 'bg-red-400',
  withdrawn: 'bg-gray-400',
  ghosted: 'bg-gray-300',
};

const TERMINAL_LABEL_COLORS: Record<ApplicationStatus, string> = {
  accepted: 'text-green-600',
  rejected: 'text-red-500',
  withdrawn: 'text-gray-500',
  ghosted: 'text-gray-400',
  applied: '',
  screening: '',
  phone_interview: '',
  technical_interview: '',
  onsite: '',
  offer: '',
};

// ---------- sub-components ----------

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{children}</h2>;
}

// ---------- main component ----------

export function Dashboard() {
  const { data: applications = [], isLoading: appsLoading } = useApplications();
  const { data: resumes = [] } = useResumes();

  const stats = useMemo(() => computeMetrics(applications), [applications]);

  const pipelineMax = useMemo(
    () => Math.max(1, ...PIPELINE_STATUSES.map(s => stats.byStatus.get(s) ?? 0)),
    [stats.byStatus],
  );

  const resumeRows = useMemo(() => computeResumeRows(resumes, applications), [resumes, applications]);

  const staleApps = useMemo(() => {
    const now = Date.now();
    const staleMs = 14 * 86400 * 1000;
    return applications
      .filter(a => PIPELINE_STATUSES.includes(a.status) && now - new Date(a.lastActivityAt).getTime() > staleMs)
      .sort((a, b) => new Date(a.lastActivityAt).getTime() - new Date(b.lastActivityAt).getTime());
  }, [applications]);

  if (appsLoading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (applications.length === 0) {
    return (
      <div className="p-8">
        <h1 className="mb-6 text-2xl font-bold">Dashboard</h1>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-muted-foreground">No applications yet — add some to see analytics here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="mb-6 text-xl font-bold sm:text-2xl">Dashboard</h1>

      {/* Summary stats */}
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total applications" value={stats.total} />
        <StatCard label="Active in pipeline" value={stats.active} />
        <StatCard
          label="Stale (>14 days)"
          value={stats.stale}
          sub={stats.stale > 0 ? 'no recent activity' : undefined}
        />
        <StatCard
          label="Reached screening+"
          value={`${stats.responseRate}%`}
          sub={`${applications.filter(a => SCREENING_PLUS.includes(a.status)).length} of ${stats.total}`}
        />
      </div>

      {/* Application funnel */}
      <div className="mb-8">
        <SectionHeader>Pipeline funnel</SectionHeader>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-2.5">
            {PIPELINE_STATUSES.map(status => {
              const count = stats.byStatus.get(status) ?? 0;
              const pct = Math.round((count / pipelineMax) * 100);
              return (
                <div key={status} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-right text-xs text-muted-foreground sm:w-36">
                    {STATUS_LABELS[status]}
                  </span>
                  <div className="flex flex-1 items-center gap-2">
                    <div className="flex-1 overflow-hidden rounded-full bg-muted" style={{ height: 10 }}>
                      <div
                        className={cn('h-full rounded-full transition-all', BAR_COLORS[status])}
                        style={{ width: count === 0 ? 0 : `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                    <span className="w-6 text-right text-xs font-medium">{count}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Terminal outcomes inline */}
          <div className="mt-4 flex flex-wrap gap-4 border-t border-border pt-4">
            {TERMINAL_STATUSES.map(status => {
              const count = stats.byStatus.get(status) ?? 0;
              return (
                <div key={status} className="flex items-baseline gap-1.5">
                  <span className={cn('text-lg font-bold', TERMINAL_LABEL_COLORS[status])}>{count}</span>
                  <span className="text-xs text-muted-foreground">{STATUS_LABELS[status]}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Resume response rate */}
        {resumes.length > 0 && (
          <div>
            <SectionHeader>Resume performance</SectionHeader>
            {/* Desktop table */}
            <div className="hidden rounded-lg border border-border bg-card sm:block">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr className="text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 text-left font-medium">Resume</th>
                    <th className="px-4 py-2.5 text-right font-medium">Used</th>
                    <th className="px-4 py-2.5 text-right font-medium">Screening+</th>
                    <th className="px-4 py-2.5 text-right font-medium">Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {resumeRows.map(r => (
                    <tr key={r.versionId} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5 font-medium">{r.label}</td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">{r.usingCount}</td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">{r.advancedCount}</td>
                      <td className="px-4 py-2.5 text-right">
                        {r.rate === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className={cn('font-medium', r.rate >= 50 ? 'text-green-600' : r.rate >= 20 ? 'text-yellow-600' : 'text-muted-foreground')}>
                            {r.rate}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="space-y-3 sm:hidden">
              {resumeRows.map(r => (
                <div key={r.versionId} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{r.label}</span>
                    {r.rate === null ? (
                      <span className="text-sm text-muted-foreground">—</span>
                    ) : (
                      <span className={cn('text-sm font-medium', r.rate >= 50 ? 'text-green-600' : r.rate >= 20 ? 'text-yellow-600' : 'text-muted-foreground')}>
                        {r.rate}%
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Used {r.usingCount} · Screening+ {r.advancedCount}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Time in stage */}
        <div>
          <SectionHeader>Avg days in stage</SectionHeader>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-2.5">
              {(() => {
                const rows = PIPELINE_STATUSES.map(s => ({ status: s, avg: avgTimeInStage(applications, s) })).filter(r => r.avg !== null);
                if (rows.length === 0) {
                  return <p className="text-sm text-muted-foreground">No data yet.</p>;
                }
                const maxDays = Math.max(1, ...rows.map(r => r.avg!));
                return rows.map(({ status, avg }) => (
                  <div key={status} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-right text-xs text-muted-foreground sm:w-36">
                      {STATUS_LABELS[status]}
                    </span>
                    <div className="flex flex-1 items-center gap-2">
                      <div className="flex-1 overflow-hidden rounded-full bg-muted" style={{ height: 10 }}>
                        <div
                          className={cn('h-full rounded-full transition-all', BAR_COLORS[status])}
                          style={{ width: `${Math.max(Math.round((avg! / maxDays) * 100), 2)}%` }}
                        />
                      </div>
                      <span className="w-12 text-right text-xs font-medium">{avg}d</span>
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Stale applications list */}
      {staleApps.length > 0 && (
        <div>
          <SectionHeader>Stale applications — no activity in 14+ days</SectionHeader>
          {/* Desktop table */}
          <div className="hidden rounded-lg border border-border bg-card lg:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr className="text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">Company</th>
                  <th className="px-4 py-2.5 text-left font-medium">Role</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Last activity</th>
                  <th className="px-4 py-2.5 text-right font-medium">Days idle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {staleApps.map(app => {
                  const daysIdle = Math.floor((Date.now() - new Date(app.lastActivityAt).getTime()) / 86400000);
                  return (
                    <tr key={app.appId} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5 font-medium">{app.company}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{app.role}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs text-muted-foreground">{STATUS_LABELS[app.status]}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">
                        {new Date(app.lastActivityAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-destructive">{daysIdle}d</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <div className="space-y-3 lg:hidden">
            {staleApps.map(app => {
              const daysIdle = Math.floor((Date.now() - new Date(app.lastActivityAt).getTime()) / 86400000);
              return (
                <div key={app.appId} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{app.company}</p>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">{app.role}</p>
                    </div>
                    <span className="shrink-0 text-sm font-medium text-destructive">{daysIdle}d idle</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {STATUS_LABELS[app.status]} · last activity {new Date(app.lastActivityAt).toLocaleDateString()}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
