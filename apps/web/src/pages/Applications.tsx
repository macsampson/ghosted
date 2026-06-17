import { useState } from 'react';
import { Plus, ExternalLink, Pencil, Trash2, X } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { useApplications, useCreateApplication, useUpdateApplication, useDeleteApplication } from '@/hooks/useApplications';
import { useResumes } from '@/hooks/useResumes';
import { STATUS_LABELS, PIPELINE_STATUSES, TERMINAL_STATUSES, type Application, type ApplicationStatus } from '@/types';
import { filterApplications, type FilterOption } from '@/lib/applicationFilter';

const FILTER_OPTIONS: { value: FilterOption; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'all', label: 'All' },
  ...[...PIPELINE_STATUSES, ...TERMINAL_STATUSES].map(s => ({ value: s as FilterOption, label: STATUS_LABELS[s] })),
];

const STATUS_COLORS: Record<ApplicationStatus, string> = {
  applied: 'bg-blue-100 text-blue-700',
  screening: 'bg-purple-100 text-purple-700',
  online_assessment: 'bg-teal-100 text-teal-700',
  phone_interview: 'bg-yellow-100 text-yellow-700',
  technical_interview: 'bg-orange-100 text-orange-700',
  onsite: 'bg-pink-100 text-pink-700',
  offer: 'bg-green-100 text-green-700',
  accepted: 'bg-green-200 text-green-800',
  rejected: 'bg-red-100 text-red-600',
  withdrawn: 'bg-gray-100 text-gray-500',
  ghosted: 'bg-gray-100 text-gray-400 italic',
};

function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_COLORS[status])}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function formatSalary(app: Application) {
  return app.salaryRange
    ? `$${(app.salaryRange.min / 1000).toFixed(0)}k–$${(app.salaryRange.max / 1000).toFixed(0)}k`
    : '—';
}

function RowActions({
  app,
  onEdit,
  deleteConfirm,
  setDeleteConfirm,
  onDelete,
}: {
  app: Application;
  onEdit: () => void;
  deleteConfirm: string | null;
  setDeleteConfirm: (id: string | null) => void;
  onDelete: (appId: string) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        onClick={onEdit}
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      {deleteConfirm === app.appId ? (
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">Delete?</span>
          <button onClick={() => onDelete(app.appId)}
            className="font-medium text-destructive hover:underline">Yes</button>
          <button onClick={() => setDeleteConfirm(null)}
            className="text-muted-foreground hover:underline">No</button>
        </div>
      ) : (
        <button
          onClick={() => setDeleteConfirm(app.appId)}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

const EMPTY_FORM = {
  company: '',
  role: '',
  jobUrl: '',
  status: 'applied' as ApplicationStatus,
  appliedAt: new Date().toISOString().slice(0, 10),
  notes: '',
  resumeVersionId: '',
  salaryMin: '',
  salaryMax: '',
};

type FormState = typeof EMPTY_FORM;

function ApplicationForm({
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  initial?: Partial<FormState>;
  onSubmit: (data: FormState) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const { data: resumes = [] } = useResumes();
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, ...initial });
  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));

  return (
    <form
      onSubmit={e => { e.preventDefault(); onSubmit(form); }}
      className="flex flex-col gap-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Company *</span>
          <input required value={form.company} onChange={set('company')}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Role *</span>
          <input required value={form.role} onChange={set('role')}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Job URL</span>
        <input type="url" value={form.jobUrl} onChange={set('jobUrl')} placeholder="https://..."
          className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Status</span>
          <select value={form.status} onChange={set('status')}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            {[...PIPELINE_STATUSES, ...TERMINAL_STATUSES].map(s => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Applied date</span>
          <input type="date" value={form.appliedAt} onChange={set('appliedAt')}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <div className="flex items-center justify-between">
          <span className="font-medium">Salary range</span>
          {(form.salaryMin || form.salaryMax) && (
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, salaryMin: '', salaryMax: '' }))}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <input type="number" value={form.salaryMin} onChange={set('salaryMin')} placeholder="Min"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          <input type="number" value={form.salaryMax} onChange={set('salaryMax')} placeholder="Max"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
      </div>

      {resumes.length > 0 && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Resume version</span>
          <select value={form.resumeVersionId} onChange={set('resumeVersionId')}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="">— none —</option>
            {resumes.map(r => <option key={r.versionId} value={r.versionId}>{r.label}</option>)}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Notes</span>
        <textarea value={form.notes} onChange={set('notes')} rows={3} placeholder="Recruiter name, referral, prep notes..."
          className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel}
          className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:bg-accent">
          Cancel
        </button>
        <button type="submit" disabled={submitting}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {submitting ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function formToPayload(form: FormState) {
  const appliedAt = form.appliedAt ? new Date(form.appliedAt).toISOString() : undefined;
  const salaryRange = form.salaryMin && form.salaryMax
    ? { min: Number(form.salaryMin), max: Number(form.salaryMax), currency: 'USD' }
    : undefined;
  return {
    company: form.company,
    role: form.role,
    jobUrl: form.jobUrl || undefined,
    status: form.status,
    appliedAt,
    salaryRange,
    notes: form.notes || undefined,
    resumeVersionId: form.resumeVersionId || undefined,
  };
}

function formToUpdatePayload(form: FormState) {
  const base = formToPayload(form);
  // Explicitly null so the API issues a REMOVE when salary was cleared
  return { ...base, salaryRange: base.salaryRange ?? null };
}

function appToForm(app: Application): Partial<FormState> {
  return {
    company: app.company,
    role: app.role,
    jobUrl: app.jobUrl ?? '',
    status: app.status,
    appliedAt: app.appliedAt?.slice(0, 10) ?? '',
    notes: app.notes ?? '',
    resumeVersionId: app.resumeVersionId ?? '',
    salaryMin: app.salaryRange?.min?.toString() ?? '',
    salaryMax: app.salaryRange?.max?.toString() ?? '',
  };
}

type ModalState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; app: Application };

export function Applications() {
  const { data: rawApplications = [], isLoading } = useApplications();
  const [filter, setFilter] = useState<FilterOption>('active');
  const applications = filterApplications(rawApplications, filter)
    .slice()
    .sort((a, b) => {
      const aDate = a.appliedAt ?? '';
      const bDate = b.appliedAt ?? '';
      return bDate.localeCompare(aDate);
    });
  const createMutation = useCreateApplication();
  const updateMutation = useUpdateApplication();
  const deleteMutation = useDeleteApplication();
  const [modal, setModal] = useState<ModalState>({ mode: 'closed' });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const handleSubmit = async (form: FormState) => {
    if (modal.mode === 'create') {
      await createMutation.mutateAsync(formToPayload(form));
    } else if (modal.mode === 'edit') {
      await updateMutation.mutateAsync({ appId: modal.app.appId, ...formToUpdatePayload(form) });
    }
    setModal({ mode: 'closed' });
  };

  const handleDelete = async (appId: string) => {
    await deleteMutation.mutateAsync(appId);
    setDeleteConfirm(null);
  };

  const submitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold sm:text-2xl">Applications</h1>
        <button
          onClick={() => setModal({ mode: 'create' })}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Add application
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              filter === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : applications.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          {rawApplications.length === 0 ? (
            <>
              <p className="text-muted-foreground">No applications yet.</p>
              <button
                onClick={() => setModal({ mode: 'create' })}
                className="mt-3 text-sm text-primary hover:underline"
              >
                Add your first one
              </button>
            </>
          ) : (
            <>
              <p className="text-muted-foreground">No applications match this filter.</p>
              <button
                onClick={() => setFilter('all')}
                className="mt-3 text-sm text-primary hover:underline"
              >
                Show all
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-lg border border-border lg:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Company</th>
                  <th className="px-4 py-3 text-left font-medium">Role</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Applied</th>
                  <th className="px-4 py-3 text-left font-medium">Salary</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {applications.map(app => (
                  <tr key={app.appId} className="bg-card hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        {app.company}
                        {app.jobUrl && (
                          <a href={app.jobUrl} target="_blank" rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{app.role}</td>
                    <td className="px-4 py-3"><StatusBadge status={app.status} /></td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {app.appliedAt ? formatDate(app.appliedAt) : '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatSalary(app)}</td>
                    <td className="px-4 py-3">
                      <RowActions
                        app={app}
                        onEdit={() => setModal({ mode: 'edit', app })}
                        deleteConfirm={deleteConfirm}
                        setDeleteConfirm={setDeleteConfirm}
                        onDelete={handleDelete}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 lg:hidden">
            {applications.map(app => (
              <div key={app.appId} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-medium">
                      <span className="truncate">{app.company}</span>
                      {app.jobUrl && (
                        <a href={app.jobUrl} target="_blank" rel="noopener noreferrer"
                          className="shrink-0 text-muted-foreground hover:text-foreground">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">{app.role}</p>
                  </div>
                  <StatusBadge status={app.status} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {app.appliedAt ? formatDate(app.appliedAt) : '—'}
                    {app.salaryRange && <span className="ml-2">{formatSalary(app)}</span>}
                  </span>
                  <RowActions
                    app={app}
                    onEdit={() => setModal({ mode: 'edit', app })}
                    deleteConfirm={deleteConfirm}
                    setDeleteConfirm={setDeleteConfirm}
                    onDelete={handleDelete}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Create/Edit modal */}
      {modal.mode !== 'closed' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {modal.mode === 'create' ? 'Add application' : 'Edit application'}
              </h2>
              <button onClick={() => setModal({ mode: 'closed' })}
                className="rounded p-1 text-muted-foreground hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ApplicationForm
              initial={modal.mode === 'edit' ? appToForm(modal.app) : undefined}
              onSubmit={handleSubmit}
              onCancel={() => setModal({ mode: 'closed' })}
              submitting={submitting}
            />
          </div>
        </div>
      )}
    </div>
  );
}
