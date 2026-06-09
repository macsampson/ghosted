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
import { cn } from '@/lib/utils';
import { useApplications, useUpdateApplication } from '@/hooks/useApplications';
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
        'rounded-lg border border-border bg-card p-3 shadow-sm cursor-grab active:cursor-grabbing select-none',
        isDragging && 'opacity-40',
      )}
    >
      <CardContent app={app} />
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
          <span>{new Date(app.appliedAt).toLocaleDateString()}</span>
        )}
        {app.salaryRange && (
          <span className="text-emerald-600">
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
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {STATUS_LABELS[status]}
        </span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
          {apps.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-24 flex-col gap-2 rounded-lg border border-dashed border-border p-2 transition-colors',
          isOver && 'border-primary/50 bg-primary/5',
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
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
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
    <div className="p-4 sm:p-6 lg:p-8">
      <h1 className="mb-6 text-xl font-bold sm:text-2xl">Pipeline</h1>

      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {PIPELINE_STATUSES.map(status => (
            <Column key={status} status={status} apps={byStatus[status]} />
          ))}
        </div>

        <TerminalSection apps={terminalApps} />

        <DragOverlay>
          {activeApp && (
            <div className="w-56 rounded-lg border border-border bg-card p-3 shadow-xl rotate-1 cursor-grabbing sm:w-60">
              <CardContent app={activeApp} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
