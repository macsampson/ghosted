import { CheckCheck, X, Inbox, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEmails, useConfirmEmail, useDismissEmail } from '@/hooks/useEmails';
import { StatusBadge } from '@/components/StatusBadge';
import { Card } from '@/components/ui/card';
import { type EmailEvent, type EmailClassification } from '@/types';

const CLASSIFICATION_LABELS: Record<EmailClassification, string> = {
  rejection: 'Rejection',
  interview_request: 'Interview request',
  offer: 'Offer',
  recruiter_outreach: 'Recruiter outreach',
  job_alert: 'Job alert',
  follow_up_needed: 'Follow-up needed',
  unrelated: 'Unrelated',
};

const CLASSIFICATION_COLORS: Record<EmailClassification, string> = {
  rejection: 'bg-rose-500/15 text-rose-300 border-rose-500/25',
  interview_request: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  offer: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/30',
  recruiter_outreach: 'bg-sky-500/15 text-sky-300 border-sky-500/25',
  job_alert: 'bg-violet-500/15 text-violet-300 border-violet-500/25',
  follow_up_needed: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  unrelated: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25',
};

function ClassificationBadge({ cls }: { cls: EmailClassification }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium', CLASSIFICATION_COLORS[cls])}>
      {CLASSIFICATION_LABELS[cls]}
    </span>
  );
}

function DeadlineBadge({ deadline }: { deadline: string }) {
  const due = new Date(deadline + 'T00:00:00');
  const daysLeft = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  const urgent = daysLeft <= 2;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        urgent ? 'border-rose-500/25 bg-rose-500/15 text-rose-300' : 'border-amber-500/25 bg-amber-500/15 text-amber-300',
      )}
    >
      due {due.toLocaleDateString()}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? 'bg-emerald-400' : pct >= 40 ? 'bg-amber-400' : 'bg-rose-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}

// Action-item emails (follow_up_needed to-dos, recruiter_outreach leads) carry a
// short actionSummary instead of a raw snippet.
function hasActionSummary(email: EmailEvent): boolean {
  return (
    !!email.actionSummary &&
    (email.classification === 'follow_up_needed' || email.classification === 'recruiter_outreach')
  );
}

// An action-item email with no suggested status is a pure to-do (a follow-up to
// handle or a recruiter to reply to) — there's no status to apply, so the only
// meaningful action is marking it done.
function isPureTodo(email: EmailEvent): boolean {
  return (
    !email.suggestedStatus &&
    (email.classification === 'follow_up_needed' || email.classification === 'recruiter_outreach')
  );
}

function EmailActions({ email }: { email: EmailEvent }) {
  const confirmMutation = useConfirmEmail();
  const dismissMutation = useDismissEmail();
  const busy = confirmMutation.isPending || dismissMutation.isPending;

  if (isPureTodo(email)) {
    return (
      <div className="flex items-center justify-end gap-1">
        <button
          onClick={() => dismissMutation.mutate(email.gmailMsgId)}
          disabled={busy}
          title="Mark done — you've handled this follow-up"
          className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {dismissMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <CheckCheck className="h-3 w-3" />
          )}
          Mark done
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        onClick={() => confirmMutation.mutate(email.gmailMsgId)}
        disabled={busy}
        title="Confirm — apply suggested status"
        className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {confirmMutation.isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <CheckCheck className="h-3 w-3" />
        )}
        Confirm
      </button>
      <button
        onClick={() => dismissMutation.mutate(email.gmailMsgId)}
        disabled={busy}
        title="Dismiss — no action"
        className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
      >
        {dismissMutation.isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <X className="h-3 w-3" />
        )}
        Dismiss
      </button>
    </div>
  );
}

function snippetText(email: EmailEvent) {
  if (!email.snippet) return '';
  return email.snippet.slice(0, 80) + (email.snippet.length > 80 ? '…' : '');
}

function EmailRow({ email }: { email: EmailEvent }) {
  return (
    <tr className="transition-colors hover:bg-muted/30">
      <td className="px-4 py-3">
        <p className="text-sm font-medium">{email.subject || '(no subject)'}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{email.sender}</p>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {hasActionSummary(email) ? (
          <span className="font-medium text-foreground">{email.actionSummary}</span>
        ) : (
          snippetText(email)
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <ClassificationBadge cls={email.classification} />
          {email.actionDeadline && <DeadlineBadge deadline={email.actionDeadline} />}
        </div>
      </td>
      <td className="px-4 py-3">
        <ConfidenceBar value={email.confidence} />
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {email.suggestedStatus ? <StatusBadge status={email.suggestedStatus} /> : '—'}
      </td>
      <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
        {new Date(email.receivedAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-3">
        <EmailActions email={email} />
      </td>
    </tr>
  );
}

function EmailCard({ email }: { email: EmailEvent }) {
  return (
    <Card className="p-4">
      <p className="text-sm font-medium">{email.subject || '(no subject)'}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{email.sender}</p>
      {hasActionSummary(email) ? (
        <p className="mt-2 text-xs font-medium">{email.actionSummary}</p>
      ) : email.snippet ? (
        <p className="mt-2 text-xs text-muted-foreground">{snippetText(email)}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ClassificationBadge cls={email.classification} />
        {email.actionDeadline && <DeadlineBadge deadline={email.actionDeadline} />}
        {email.suggestedStatus && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            → <StatusBadge status={email.suggestedStatus} />
          </span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <ConfidenceBar value={email.confidence} />
        <span className="text-xs tabular-nums text-muted-foreground">{new Date(email.receivedAt).toLocaleDateString()}</span>
      </div>
      <div className="mt-3">
        <EmailActions email={email} />
      </div>
    </Card>
  );
}

export function EmailReview() {
  const { data: emails = [], isLoading } = useEmails(true);

  return (
    <div className="animate-fade-in p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Email review</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Low-confidence email classifications that need your confirmation before updating application status.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : emails.length === 0 ? (
        <Card className="flex flex-col items-center justify-center border-dashed py-16 text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-300">
            <Inbox className="h-6 w-6" />
          </span>
          <p className="font-medium">All caught up</p>
          <p className="mt-1 text-sm text-muted-foreground">
            No emails waiting for review. High-confidence classifications are applied automatically.
          </p>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-hidden p-0 lg:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Email</th>
                  <th className="px-4 py-3 text-left font-medium">Snippet</th>
                  <th className="px-4 py-3 text-left font-medium">Classification</th>
                  <th className="px-4 py-3 text-left font-medium">Confidence</th>
                  <th className="px-4 py-3 text-left font-medium">Suggested status</th>
                  <th className="px-4 py-3 text-left font-medium">Received</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {emails.map(email => (
                  <EmailRow key={email.gmailMsgId} email={email} />
                ))}
              </tbody>
            </table>
          </Card>

          {/* Mobile cards */}
          <div className="space-y-3 lg:hidden">
            {emails.map(email => (
              <EmailCard key={email.gmailMsgId} email={email} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
