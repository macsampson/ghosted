import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { useApplications, useUpdateApplication } from '@/hooks/useApplications';
import { STATUS_STYLES } from '@/lib/status';
import { PIPELINE_STATUSES, TERMINAL_STATUSES, STATUS_LABELS, type Application, type ApplicationStatus } from '@/types';

// ─── Card ────────────────────────────────────────────────────────────────────

function ApplicationCard({ app, isDragging }: { app: Application; isDragging?: boolean }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: app.appId });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        'group relative cursor-grab select-none overflow-hidden rounded-lg border border-border bg-card p-3 shadow-sm transition-colors hover:border-primary/40 active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
    >
      <span className={cn('absolute inset-y-0 left-0 w-1', STATUS_STYLES[app.status].bar)} />
      <div className="pl-1.5">
        <CardContent app={app} />
      </div>
    </div>
  );
}

function CardContent({ app }: { app: Application }) {
  return (
    <>
      <p className="text-sm font-semibold leading-tight">{app.company}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{app.role}</p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {app.appliedAt && (
          <span className="tabular-nums">{formatDate(app.appliedAt)}</span>
        )}
        {app.salaryRange && (
          <span className="font-medium text-emerald-300">
            ${(app.salaryRange.min / 1000).toFixed(0)}k–${(app.salaryRange.max / 1000).toFixed(0)}k
          </span>
        )}
      </div>
    </>
  );
}

// ─── Column ──────────────────────────────────────────────────────────────────

function Column({ status, apps }: { status: ApplicationStatus; apps: Application[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="flex w-56 flex-shrink-0 flex-col gap-2 sm:w-60">
      <div className="flex items-center justify-between px-1">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span className={cn('h-2 w-2 rounded-full', STATUS_STYLES[status].dot)} />
          {STATUS_LABELS[status]}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
          {apps.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-24 flex-col gap-2 rounded-xl border border-dashed border-border p-2 transition-colors',
          isOver && 'border-primary/60 bg-primary/5',
        )}
      >
        {apps.map(app => (
          <ApplicationCard key={app.appId} app={app} />
        ))}
      </div>
    </div>
  );
}

// ─── Terminal section ────────────────────────────────────────────────────────

function TerminalSection({ apps }: { apps: Application[] }) {
  const [open, setOpen] = useState(false);

  const byStatus = TERMINAL_STATUSES.reduce<Record<string, Application[]>>((acc, s) => {
    acc[s] = apps.filter(a => a.status === s);
    return acc;
  }, {});

  const total = apps.length;

  return (
    <div className="mt-6 border-t border-border pt-4">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Closed ({total})
      </button>

      {open && (
        <div className="mt-3 flex gap-4 overflow-x-auto pb-2">
          {TERMINAL_STATUSES.map(status => (
            <Column key={status} status={status} apps={byStatus[status]} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Pipeline page ───────────────────────────────────────────────────────────

export function Pipeline() {
  const { data: applications = [], isLoading } = useApplications();
  const updateMutation = useUpdateApplication();
  const [activeApp, setActiveApp] = useState<Application | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const pipelineApps = applications.filter(a => PIPELINE_STATUSES.includes(a.status));
  const terminalApps = applications.filter(a => TERMINAL_STATUSES.includes(a.status));

  const byStatus = PIPELINE_STATUSES.reduce<Record<string, Application[]>>((acc, s) => {
    acc[s] = pipelineApps.filter(a => a.status === s);
    return acc;
  }, {});

  const handleDragStart = ({ active }: DragStartEvent) => {
    const app = applications.find(a => a.appId === active.id);
    setActiveApp(app ?? null);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveApp(null);
    if (!over || active.id === over.id) return;

    const newStatus = over.id as ApplicationStatus;
    const app = applications.find(a => a.appId === active.id);
    if (!app || app.status === newStatus) return;

    const allStatuses = [...PIPELINE_STATUSES, ...TERMINAL_STATUSES] as string[];
    if (!allStatuses.includes(newStatus)) return;

    updateMutation.mutate({ appId: app.appId, status: newStatus });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Pipeline</h1>
        <p className="mt-1 text-sm text-muted-foreground">Drag a card to move it through your stages.</p>
      </div>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {PIPELINE_STATUSES.map(status => (
            <Column key={status} status={status} apps={byStatus[status]} />
          ))}
        </div>

        <TerminalSection apps={terminalApps} />

        <DragOverlay>
          {activeApp && (
            <div className="relative w-56 rotate-2 cursor-grabbing overflow-hidden rounded-lg border border-primary/40 bg-card p-3 shadow-2xl sm:w-60">
              <span className={cn('absolute inset-y-0 left-0 w-1', STATUS_STYLES[activeApp.status].bar)} />
              <div className="pl-1.5">
                <CardContent app={activeApp} />
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
