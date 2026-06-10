import { CheckCheck, X, Inbox, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEmails, useConfirmEmail, useDismissEmail } from '@/hooks/useEmails';
import { STATUS_LABELS, type EmailEvent, type EmailClassification } from '@/types';

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
  rejection: 'bg-red-100 text-red-700',
  interview_request: 'bg-green-100 text-green-700',
  offer: 'bg-emerald-100 text-emerald-800',
  recruiter_outreach: 'bg-blue-100 text-blue-700',
  job_alert: 'bg-purple-100 text-purple-700',
  follow_up_needed: 'bg-yellow-100 text-yellow-700',
  unrelated: 'bg-gray-100 text-gray-500',
};

function ClassificationBadge({ cls }: { cls: EmailClassification }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', CLASSIFICATION_COLORS[cls])}>
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
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        urgent ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700',
      )}
    >
      due {due.toLocaleDateString()}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? 'bg-green-400' : pct >= 40 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{pct}%</span>
    </div>
  );
}

function EmailActions({ email }: { email: EmailEvent }) {
  const confirmMutation = useConfirmEmail();
  const dismissMutation = useDismissEmail();
  const busy = confirmMutation.isPending || dismissMutation.isPending;

  // A follow_up_needed email with no suggested status is a pure to-do — there's no
  // status to apply, so the only meaningful action is marking it done (dismiss).
  if (email.classification === 'follow_up_needed' && !email.suggestedStatus) {
    return (
      <div className="flex items-center justify-end gap-1">
        <button
          onClick={() => dismissMutation.mutate(email.gmailMsgId)}
          disabled={busy}
          title="Mark done — you've handled this follow-up"
          className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
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
        className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
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
        className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
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
    <tr className="bg-card hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3">
        <p className="text-sm font-medium">{email.subject || '(no subject)'}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{email.sender}</p>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {email.classification === 'follow_up_needed' && email.actionSummary ? (
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
        {email.suggestedStatus ? STATUS_LABELS[email.suggestedStatus] : '—'}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
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
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm font-medium">{email.subject || '(no subject)'}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{email.sender}</p>
      {email.classification === 'follow_up_needed' && email.actionSummary ? (
        <p className="mt-2 text-xs font-medium">{email.actionSummary}</p>
      ) : email.snippet ? (
        <p className="mt-2 text-xs text-muted-foreground">{snippetText(email)}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ClassificationBadge cls={email.classification} />
        {email.actionDeadline && <DeadlineBadge deadline={email.actionDeadline} />}
        {email.suggestedStatus && (
          <span className="text-xs text-muted-foreground">→ {STATUS_LABELS[email.suggestedStatus]}</span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <ConfidenceBar value={email.confidence} />
        <span className="text-xs text-muted-foreground">{new Date(email.receivedAt).toLocaleDateString()}</span>
      </div>
      <div className="mt-3">
        <EmailActions email={email} />
      </div>
    </div>
  );
}

export function EmailReview() {
  const { data: emails = [], isLoading } = useEmails(true);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold sm:text-2xl">Email review</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Low-confidence email classifications that need your confirmation before updating application status.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : emails.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <Inbox className="mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">All caught up</p>
          <p className="mt-1 text-sm text-muted-foreground">
            No emails waiting for review. High-confidence classifications are applied automatically.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-lg border border-border lg:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
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
          </div>

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
