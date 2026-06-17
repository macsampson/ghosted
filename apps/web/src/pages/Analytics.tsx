import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useApplications } from '@/hooks/useApplications';
import { useResumes } from '@/hooks/useResumes';
import {
  computeFunnel,
  funnelByVariant,
  responseTimesByVariant,
  velocityOverTime,
  hasEnoughData,
  NEED_MORE_DATA_N,
  type Funnel,
  type Interval,
} from '@/lib/metrics';
import { STATUS_LABELS, type Application, type ApplicationStatus } from '@/types';

// ---------- constants ----------

const STAGE_BAR_COLORS: Record<string, string> = {
  applied: 'bg-blue-400',
  screening: 'bg-purple-400',
  online_assessment: 'bg-teal-400',
  phone_interview: 'bg-yellow-400',
  technical_interview: 'bg-orange-400',
  onsite: 'bg-pink-400',
  offer: 'bg-green-400',
};

const pct = (x: number) => Math.round(x * 100);

// ---------- shared sub-components ----------

function SectionHeader({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{children}</h2>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NeedMoreDataBadge({ n }: { n: number }) {
  return (
    <span
      className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400"
      title={`Only ${n} application(s) — below ${NEED_MORE_DATA_N}. Percentages here are noisy; the confidence interval shows how wide the uncertainty is.`}
    >
      n={n} · need more data
    </span>
  );
}

/**
 * A horizontal proportion bar with the point estimate filled and the Wilson
 * confidence interval drawn as a translucent band + whisker ticks. Hand-rolled
 * with absolutely-positioned divs — the wider the band, the less certain the %.
 */
function RateBar({ ci, color }: { ci: Interval; color: string }) {
  const low = pct(ci.low);
  const high = pct(ci.high);
  const point = pct(ci.point);
  return (
    <div className="relative h-3.5 flex-1 overflow-hidden rounded-full bg-muted">
      {/* filled point estimate */}
      <div className={cn('absolute inset-y-0 left-0 rounded-full', color)} style={{ width: `${Math.max(point, 1)}%` }} />
      {/* confidence band */}
      <div
        className="absolute inset-y-0 rounded-sm bg-foreground/15"
        style={{ left: `${low}%`, width: `${Math.max(high - low, 0.5)}%` }}
        title={`95% CI: ${low}%–${high}%`}
      />
      {/* CI whisker ticks */}
      <div className="absolute inset-y-0 w-px bg-foreground/50" style={{ left: `${low}%` }} />
      <div className="absolute inset-y-0 w-px bg-foreground/50" style={{ left: `${Math.min(high, 99.7)}%` }} />
    </div>
  );
}

function FunnelCard({ title, funnel }: { title: string; funnel: Funnel }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-semibold">{title}</h3>
        {funnel.n > 0 && !hasEnoughData(funnel.n) ? (
          <NeedMoreDataBadge n={funnel.n} />
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">n={funnel.n}</span>
        )}
      </div>
      {funnel.n === 0 ? (
        <p className="text-sm text-muted-foreground">No applications.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {funnel.stages.map(stage => (
            <div key={stage.status} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-right text-xs text-muted-foreground sm:w-28">
                {STATUS_LABELS[stage.status]}
              </span>
              <RateBar ci={stage.ci} color={STAGE_BAR_COLORS[stage.status] ?? 'bg-primary'} />
              <span className="w-20 shrink-0 text-right text-xs">
                <span className="font-medium">{pct(stage.rate)}%</span>
                <span className="ml-1 text-muted-foreground">
                  {pct(stage.ci.low)}–{pct(stage.ci.high)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- main component ----------

export function Analytics() {
  const { data: applications = [], isLoading } = useApplications();
  const { data: resumes = [] } = useResumes();

  const overallFunnel = useMemo(() => computeFunnel(applications), [applications]);
  const variantFunnels = useMemo(
    () => funnelByVariant(applications, resumes).filter(v => v.n > 0),
    [applications, resumes],
  );
  const responseTimes = useMemo(
    () => responseTimesByVariant(applications, resumes).filter(r => r.respondedCount > 0),
    [applications, resumes],
  );
  const velocity = useMemo(() => velocityOverTime(applications), [applications]);

  const hasBackfill = useMemo(
    () => applications.some((a: Application) => a.statusHistory?.some(e => e.source === 'backfill')),
    [applications],
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (applications.length === 0) {
    return (
      <div className="p-8">
        <h1 className="mb-6 text-2xl font-bold">Analytics</h1>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-muted-foreground">No applications yet — add some to see analytics here.</p>
        </div>
      </div>
    );
  }

  const velocityMax = Math.max(1, ...velocity.map(v => v.applied));

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="mb-1 text-xl font-bold sm:text-2xl">Analytics</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        How each resume variant moves applications through the pipeline. Bars show the share of
        applications that reached each stage; the shaded band is the 95% Wilson confidence interval —
        wide bands mean the percentage isn't trustworthy yet.
      </p>

      {hasBackfill && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Some applications were tracked before per-transition history existed. Their funnel depth is
          estimated from current status, so terminal applications (rejected/withdrawn/ghosted) may
          undercount the stages they actually reached. New activity is recorded precisely.
        </div>
      )}

      {/* Funnel by variant */}
      <div className="mb-8">
        <SectionHeader hint="Does one resume get more screening calls but fewer technical interviews? That's the signal.">
          Funnel drop-off by resume variant
        </SectionHeader>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <FunnelCard title="All applications" funnel={overallFunnel} />
          {variantFunnels.map(v => (
            <FunnelCard key={v.versionId} title={v.label} funnel={v} />
          ))}
        </div>
      </div>

      {/* Stage-to-stage conversion */}
      <div className="mb-8">
        <SectionHeader hint="Conversion between adjacent stages — the lowest number is where that resume loses momentum.">
          Where each variant loses momentum
        </SectionHeader>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[{ versionId: 'all', label: 'All applications', ...overallFunnel }, ...variantFunnels].map(v => {
            const live = v.conversions.filter(c => c.reachedFrom > 0);
            const weakest = live.reduce<typeof live[number] | null>(
              (min, c) => (min === null || c.conversion < min.conversion ? c : min),
              null,
            );
            return (
              <div key={v.versionId} className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 truncate text-sm font-semibold">{v.label}</h3>
                {live.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Not enough progression to measure.</p>
                ) : (
                  <div className="flex flex-col gap-1.5 text-xs">
                    {live.map(c => {
                      const isWeak = weakest !== null && c === weakest && live.length > 1;
                      return (
                        <div key={`${c.from}-${c.to}`} className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">
                            {STATUS_LABELS[c.from as ApplicationStatus]} → {STATUS_LABELS[c.to as ApplicationStatus]}
                          </span>
                          <span className={cn('font-medium tabular-nums', isWeak && 'text-amber-600 dark:text-amber-400')}>
                            {pct(c.conversion)}%
                            <span className="ml-1 font-normal text-muted-foreground">
                              ({c.reachedTo}/{c.reachedFrom})
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Time to first response */}
      {responseTimes.length > 0 && (
        <div className="mb-8">
          <SectionHeader hint="Days from applying to the first screening+ response. A faster reply is meaningful signal.">
            Time to first response by variant
          </SectionHeader>
          <div className="rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr className="text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">Resume</th>
                  <th className="px-4 py-2.5 text-right font-medium">Responses</th>
                  <th className="px-4 py-2.5 text-right font-medium">Avg days</th>
                  <th className="px-4 py-2.5 text-right font-medium">Median days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {responseTimes.map(r => (
                  <tr key={r.versionId} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium">{r.label}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{r.respondedCount}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">{r.avgDays}d</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{r.medianDays}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Median is shown alongside the average because a single slow reply can skew the mean at low volume.
          </p>
        </div>
      )}

      {/* Velocity over time */}
      <div className="mb-8">
        <SectionHeader hint="Applications per week and the share that drew a response — is your approach improving over time?">
          Application velocity
        </SectionHeader>
        <div className="rounded-lg border border-border bg-card p-4">
          {velocity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          ) : (
            <div className="flex items-end gap-2 overflow-x-auto pb-2">
              {velocity.map(b => (
                <div key={b.weekStart} className="flex min-w-[2.5rem] flex-col items-center gap-1">
                  <div className="flex h-32 w-full items-end justify-center">
                    <div
                      className="relative w-6 overflow-hidden rounded-t bg-muted"
                      style={{ height: `${Math.max((b.applied / velocityMax) * 100, 4)}%` }}
                      title={`${b.applied} applied, ${pct(b.responseRate)}% reached screening+`}
                    >
                      {/* responded portion fills from the bottom */}
                      <div
                        className="absolute inset-x-0 bottom-0 bg-purple-400"
                        style={{ height: `${pct(b.responseRate)}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-[10px] font-medium tabular-nums">{b.applied}</span>
                  <span className="text-[10px] text-muted-foreground">{b.weekStart.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-muted" /> applied
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-purple-400" /> reached screening+
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
