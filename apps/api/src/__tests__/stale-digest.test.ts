import { describe, it, expect } from 'vitest';
import { isPipelineStatus, buildDigestBody, buildDigestSubject } from '../handlers/stale-digest';

// ---------- isPipelineStatus ----------

describe('isPipelineStatus', () => {
  it('treats applied as a pipeline status', () => {
    expect(isPipelineStatus('applied')).toBe(true);
  });

  it('treats the in-progress pipeline stages as pipeline statuses', () => {
    const pipeline = ['applied', 'screening', 'phone_interview', 'technical_interview', 'onsite', 'offer'];
    expect(pipeline.every(isPipelineStatus)).toBe(true);
  });

  it('treats accepted as terminal (a successful outcome, never re-ghosted)', () => {
    expect(isPipelineStatus('accepted')).toBe(false);
  });

  it('treats rejected as terminal', () => {
    expect(isPipelineStatus('rejected')).toBe(false);
  });

  it('treats withdrawn as terminal', () => {
    expect(isPipelineStatus('withdrawn')).toBe(false);
  });

  it('treats ghosted as terminal', () => {
    expect(isPipelineStatus('ghosted')).toBe(false);
  });
});

// ---------- daysSince ----------

function daysSince(isoTimestamp: string, now: Date): number {
  const then = new Date(isoTimestamp).getTime();
  return (now.getTime() - then) / (1000 * 60 * 60 * 24);
}

describe('daysSince', () => {
  it('returns 0 for now', () => {
    const now = new Date();
    expect(daysSince(now.toISOString(), now)).toBeCloseTo(0, 5);
  });

  it('returns ~14 for a timestamp 14 days ago', () => {
    const now = new Date('2026-06-03T12:00:00Z');
    const fourteenDaysAgo = new Date('2026-05-20T12:00:00Z');
    expect(daysSince(fourteenDaysAgo.toISOString(), now)).toBeCloseTo(14, 1);
  });

  it('returns a fractional day for a timestamp 12 hours ago', () => {
    const now = new Date('2026-06-03T12:00:00Z');
    const twelveHoursAgo = new Date('2026-06-03T00:00:00Z');
    expect(daysSince(twelveHoursAgo.toISOString(), now)).toBeCloseTo(0.5, 5);
  });
});

// ---------- isStaleApplication ----------

function isStaleApplication(
  app: { status: string; lastActivityAt: string },
  now: Date,
  daysThreshold: number,
): boolean {
  return isPipelineStatus(app.status) && daysSince(app.lastActivityAt, now) >= daysThreshold;
}

// ---------- isGhostCandidate ----------

const GHOST_DAYS = 30;

function isGhostCandidate(
  app: { status: string; lastActivityAt: string },
  now: Date,
): boolean {
  return isPipelineStatus(app.status) && daysSince(app.lastActivityAt, now) >= GHOST_DAYS;
}

describe('isGhostCandidate', () => {
  const now = new Date('2026-06-03T12:00:00Z');

  it('flags a pipeline app idle for 31 days', () => {
    const app = { status: 'applied', lastActivityAt: '2026-05-03T12:00:00Z' };
    expect(isGhostCandidate(app, now)).toBe(true);
  });

  it('does not flag a pipeline app idle for 29 days', () => {
    const app = { status: 'applied', lastActivityAt: '2026-05-05T12:00:00Z' };
    expect(isGhostCandidate(app, now)).toBe(false);
  });

  it('flags an app idle for exactly 30 days', () => {
    const app = { status: 'screening', lastActivityAt: '2026-05-04T12:00:00Z' };
    expect(isGhostCandidate(app, now)).toBe(true);
  });

  it('does not flag a terminal app even if idle for 60 days', () => {
    const app = { status: 'rejected', lastActivityAt: '2025-01-01T00:00:00Z' };
    expect(isGhostCandidate(app, now)).toBe(false);
  });

  it('does not flag an already-ghosted app', () => {
    const app = { status: 'ghosted', lastActivityAt: '2025-01-01T00:00:00Z' };
    expect(isGhostCandidate(app, now)).toBe(false);
  });
});

describe('isStaleApplication', () => {
  const now = new Date('2026-06-03T12:00:00Z');

  it('flags a pipeline app with no activity for 15 days as stale', () => {
    const app = { status: 'applied', lastActivityAt: '2026-05-19T12:00:00Z' };
    expect(isStaleApplication(app, now, 14)).toBe(true);
  });

  it('does not flag a pipeline app with activity 13 days ago', () => {
    const app = { status: 'applied', lastActivityAt: '2026-05-21T12:00:00Z' };
    expect(isStaleApplication(app, now, 14)).toBe(false);
  });

  it('does not flag a terminal app even if inactive for a long time', () => {
    const app = { status: 'rejected', lastActivityAt: '2025-01-01T00:00:00Z' };
    expect(isStaleApplication(app, now, 14)).toBe(false);
  });

  it('flags an app inactive for exactly the threshold as stale', () => {
    const app = { status: 'screening', lastActivityAt: '2026-05-20T12:00:00Z' };
    expect(isStaleApplication(app, now, 14)).toBe(true);
  });
});

// ---------- digest body / subject ----------

describe('buildDigestBody', () => {
  const now = new Date('2026-06-03T12:00:00Z');
  const stale = [{ company: 'Stripe', role: 'SWE', status: 'screening', lastActivityAt: '2026-05-16T12:00:00Z' }];

  it('renders only the stale section when there are no action items', () => {
    const body = buildDigestBody(stale, [], now);
    expect(body).toContain('no activity in 14+ days');
    expect(body).toContain('• Stripe — SWE (screening, 18d idle)');
    expect(body).not.toContain('need action');
  });

  it('renders an action-needed section with summaries and deadlines', () => {
    const body = buildDigestBody([], [
      { actionSummary: 'Complete the coding assessment', actionDeadline: '2026-06-06', subject: 'Next steps' },
      { actionSummary: 'Send three references', subject: 'References' },
    ], now);
    expect(body).toContain('need action');
    expect(body).toContain('• Complete the coding assessment (due 2026-06-06)');
    expect(body).toContain('• Send three references');
  });

  it('falls back to the email subject when no action summary was extracted', () => {
    const body = buildDigestBody([], [{ subject: 'Please upload your portfolio' }], now);
    expect(body).toContain('• Please upload your portfolio');
  });

  it('renders both sections together', () => {
    const body = buildDigestBody(stale, [{ actionSummary: 'Reply to recruiter' }], now);
    expect(body).toContain('no activity in 14+ days');
    expect(body).toMatch(/needs? action/);
  });
});

describe('buildDigestSubject', () => {
  it('describes stale applications when any exist', () => {
    expect(buildDigestSubject(2, 3)).toBe('Ghosted: 2 stale applications need follow-up');
    expect(buildDigestSubject(1, 0)).toBe('Ghosted: 1 stale application need follow-up');
  });

  it('describes action items when there are no stale applications', () => {
    expect(buildDigestSubject(0, 2)).toBe('Ghosted: 2 emails need action');
    expect(buildDigestSubject(0, 1)).toBe('Ghosted: 1 email needs action');
  });
});
