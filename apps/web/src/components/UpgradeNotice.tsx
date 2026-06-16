import { Link } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';

interface UpgradeNoticeProps {
  message: string;
  onDismiss?: () => void;
}

/** Inline banner shown when a free-plan limit is hit, linking to the pricing page. */
export function UpgradeNotice({ message, onDismiss }: UpgradeNoticeProps) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="flex-1">
        <span className="text-foreground">{message}</span>{' '}
        <Link to="/pricing" className="font-semibold text-primary hover:underline">
          View plans →
        </Link>
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
