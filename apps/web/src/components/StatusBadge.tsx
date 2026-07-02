import { cn } from '@/lib/utils';
import { STATUS_LABELS, type ApplicationStatus } from '@/types';
import { STATUS_STYLES } from '@/lib/status';

/** Pill showing an application status with its themed color + a leading dot. */
export function StatusBadge({
  status,
  className,
}: {
  status: ApplicationStatus;
  className?: string;
}) {
  const style = STATUS_STYLES[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium',
        style.badge,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
      {STATUS_LABELS[status]}
    </span>
  );
}
