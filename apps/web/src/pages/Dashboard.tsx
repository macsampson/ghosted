import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useApplications } from '@/hooks/useApplications';
import { useResumes } from '@/hooks/useResumes';
import { useEmails } from '@/hooks/useEmails';
import { computeMetrics, computeResumeRows, avgTimeInStage, staleAnchorAt, SCREENING_PLUS } from '@/lib/metrics';
import { STATUS_STYLES } from '@/lib/status';
import { StatusBadge } from '@/components/StatusBadge';
import { Card } from '@/components/ui/card';
import {
  PIPELINE_STATUSES,
  TERMINAL_STATUSES,
  STATUS_LABELS,
} from '@/types';
import { Layers, Activity, Clock, TrendingUp, Inbox } from 'lucide-react';

// ---------- sub-components ----------

type Accent = 'primary' | 'sky' | 'amber' | 'emerald' | 'rose';

const ACCENTS: Record<Accent, { icon: string; ring: string }> = {
  primary: { icon: 'bg-primary/15 text-primary', ring: 'from-primary/10' },
  sky: { icon: 'bg-sky-500/15 text-sky-300', ring: 'from-sky-500/10' },
  amber: { icon: 'bg-amber-500/15 text-amber-300', ring: 'from-amber-500/10' },
  emerald: { icon: 'bg-emerald-500/15 text-emerald-300', ring: 'from-emerald-500/10' },
  rose: { icon: 'bg-rose-500/15 text-rose-300', ring: 'from-rose-500/10' },
};

function StatCard({
  label,
  value,
  sub,
  Icon,
  accent = 'primary',
}: {
  label: string;
  value: string | number;
  sub?: string;
  Icon: React.ComponentType<{ className?: string }>;
  accent?: Accent;
}) {
  const a = ACCENTS[accent];
  return (
    <Card className="relative overflow-hidden p-5">
      <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent', a.ring)} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
          {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', a.icon)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </Card>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

// ---------- main component ----------

export function Dashboard() {
  const { data: applications = [], isLoading: appsLoading } = useApplications();
  const { data: resumes = [] } = useResumes();
  const { data: reviewEmails = [] } = useEmails(true);

  const stats = useMemo(() => computeMetrics(applications), [applications]);

  const pipelineMax = useMemo(
    () => Math.max(1, ...PIPELINE_STATUSES.map(s => stats.byStatus.get(s) ?? 0)),
    [stats.byStatus],
  );

  const resumeRows = useMemo(() => computeResumeRows(resumes, applications), [resumes, applications]);

  const actionItems = useMemo(() => {
    const byId = new Map(applications.map(a => [a.appId, a]));
    return reviewEmails
      .filter(e => (e.classification === 'follow_up_needed' || e.classification === 'recruiter_outreach') && e.needsReview)
      .map(e => {
        const app = e.applicationId ? byId.get(e.applicationId) : undefined;
        return {
          emailId: e.gmailMsgId,
          company: app?.company,
          role: app?.role,
          actionSummary: e.actionSummary,
          actionDeadline: e.actionDeadline,
          subject: e.subject,
        };
      });
  }, [reviewEmails, applications]);

  const staleApps = useMemo(() => {
    const now = Date.now();
    const staleMs = 14 * 86400 * 1000;
    return applications
      .filter(a => PIPELINE_STATUSES.includes(a.status) && now - new Date(staleAnchorAt(a)).getTime() > staleMs)
      .sort((a, b) => new Date(staleAnchorAt(a)).getTime() - new Date(staleAnchorAt(b)).getTime());
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
      <div className="p-4 sm:p-6 lg:p-8">
        <h1 className="mb-6 text-2xl font-bold tracking-tight">Dashboard</h1>
        <Card className="flex flex-col items-center justify-center border-dashed py-16 text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Layers className="h-6 w-6" />
          </span>
          <p className="text-muted-foreground">No applications yet — add some to see analytics here.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-in p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your job search at a glance.</p>
      </div>

      {/* Summary stats */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total applications" value={stats.total} Icon={Layers} accent="primary" />
        <StatCard label="Active in pipeline" value={stats.active} Icon={Activity} accent="sky" />
        <StatCard
          label="Stale (>14 days)"
          value={stats.stale}
          sub={stats.stale > 0 ? 'no recent activity' : undefined}
          Icon={Clock}
          accent={stats.stale > 0 ? 'amber' : 'emerald'}
        />
        <StatCard
          label="Reached screening+"
          value={`${stats.responseRate}%`}
          sub={`${applications.filter(a => SCREENING_PLUS.includes(a.status)).length} of ${stats.total}`}
          Icon={TrendingUp}
          accent="emerald"
        />
        {actionItems.length > 0 && (
          <StatCard label="Action needed" value={actionItems.length} sub="from your inbox" Icon={Inbox} accent="rose" />
        )}
      </div>

      {/* Application funnel */}
      <div className="mb-8">
        <SectionHeader>Pipeline funnel</SectionHeader>
        <Card className="p-5">
          <div className="flex flex-col gap-3">
            {PIPELINE_STATUSES.map(status => {
              const count = stats.byStatus.get(status) ?? 0;
              const pct = Math.round((count / pipelineMax) * 100);
              return (
                <div key={status} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-right text-xs text-muted-foreground sm:w-36">
                    {STATUS_LABELS[status]}
                  </span>
                  <div className="flex flex-1 items-center gap-2">
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn('h-full rounded-full transition-all duration-500', STATUS_STYLES[status].bar)}
                        style={{ width: count === 0 ? 0 : `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                    <span className="w-6 text-right text-xs font-semibold tabular-nums">{count}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Terminal outcomes inline */}
          <div className="mt-5 flex flex-wrap gap-5 border-t border-border pt-4">
            {TERMINAL_STATUSES.map(status => {
              const count = stats.byStatus.get(status) ?? 0;
              return (
                <div key={status} className="flex items-baseline gap-1.5">
                  <span className={cn('text-lg font-bold tabular-nums', STATUS_STYLES[status].text)}>{count}</span>
                  <span className="text-xs text-muted-foreground">{STATUS_LABELS[status]}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Resume response rate */}
        {resumes.length > 0 && (
          <div>
            <SectionHeader>Resume performance</SectionHeader>
            {/* Desktop table */}
            <Card className="hidden overflow-hidden p-0 sm:block">
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr className="text-xs text-muted-foreground">
                    <th className="px-4 py-3 text-left font-medium">Resume</th>
                    <th className="px-4 py-3 text-right font-medium">Used</th>
                    <th className="px-4 py-3 text-right font-medium">Screening+</th>
                    <th className="px-4 py-3 text-right font-medium">Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {resumeRows.map(r => (
                    <tr key={r.versionId} className="transition-colors hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium">{r.label}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{r.usingCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{r.advancedCount}</td>
                      <td className="px-4 py-3 text-right">
                        {r.rate === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className={cn('font-semibold tabular-nums', r.rate >= 50 ? 'text-emerald-300' : r.rate >= 20 ? 'text-amber-300' : 'text-muted-foreground')}>
                            {r.rate}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            {/* Mobile cards */}
            <div className="space-y-3 sm:hidden">
              {resumeRows.map(r => (
                <Card key={r.versionId} className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{r.label}</span>
                    {r.rate === null ? (
                      <span className="text-sm text-muted-foreground">—</span>
                    ) : (
                      <span className={cn('text-sm font-semibold', r.rate >= 50 ? 'text-emerald-300' : r.rate >= 20 ? 'text-amber-300' : 'text-muted-foreground')}>
                        {r.rate}%
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Used {r.usingCount} · Screening+ {r.advancedCount}
                  </p>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Time in stage */}
        <div>
          <SectionHeader>Avg days in stage</SectionHeader>
          <Card className="p-5">
            <div className="flex flex-col gap-3">
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
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn('h-full rounded-full transition-all duration-500', STATUS_STYLES[status].bar)}
                          style={{ width: `${Math.max(Math.round((avg! / maxDays) * 100), 2)}%` }}
                        />
                      </div>
                      <span className="w-12 text-right text-xs font-semibold tabular-nums">{avg}d</span>
                    </div>
                  </div>
                ));
              })()}
            </div>
          </Card>
        </div>
      </div>

      {/* Action needed — open follow-ups from the inbox */}
      {actionItems.length > 0 && (
        <div className="mb-8">
          <SectionHeader>Action needed — follow-ups from your inbox</SectionHeader>
          <Card className="divide-y divide-border p-0">
            {actionItems.map(item => (
              <div key={item.emailId} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {item.actionSummary || item.subject || 'Follow up'}
                  </p>
                  {item.company && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {item.company}{item.role ? ` — ${item.role}` : ''}
                    </p>
                  )}
                </div>
                {item.actionDeadline && (
                  <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
                    due {new Date(item.actionDeadline + 'T00:00:00').toLocaleDateString()}
                  </span>
                )}
              </div>
            ))}
          </Card>
        </div>
      )}

      {/* Stale applications list */}
      {staleApps.length > 0 && (
        <div>
          <SectionHeader>Stale applications — no activity in 14+ days</SectionHeader>
          {/* Desktop table */}
          <Card className="hidden overflow-hidden p-0 lg:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr className="text-xs text-muted-foreground">
                  <th className="px-4 py-3 text-left font-medium">Company</th>
                  <th className="px-4 py-3 text-left font-medium">Role</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Last activity</th>
                  <th className="px-4 py-3 text-right font-medium">Days idle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {staleApps.map(app => {
                  const daysIdle = Math.floor((Date.now() - new Date(staleAnchorAt(app)).getTime()) / 86400000);
                  return (
                    <tr key={app.appId} className="transition-colors hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium">{app.company}</td>
                      <td className="px-4 py-3 text-muted-foreground">{app.role}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={app.status} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {new Date(staleAnchorAt(app)).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-destructive">{daysIdle}d</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          {/* Mobile cards */}
          <div className="space-y-3 lg:hidden">
            {staleApps.map(app => {
              const daysIdle = Math.floor((Date.now() - new Date(staleAnchorAt(app)).getTime()) / 86400000);
              return (
                <Card key={app.appId} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{app.company}</p>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">{app.role}</p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-destructive">{daysIdle}d idle</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <StatusBadge status={app.status} />
                    <span className="text-xs text-muted-foreground">
                      last activity {new Date(staleAnchorAt(app)).toLocaleDateString()}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
