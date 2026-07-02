import { useState } from 'react';
import { Plus, ExternalLink, Pencil, Trash2, Search, ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
import { cn, formatDate, todayLocalDate, calendarDateToISO } from '@/lib/utils';
import { useApplications, useCreateApplication, useUpdateApplication, useDeleteApplication } from '@/hooks/useApplications';
import { useResumes } from '@/hooks/useResumes';
import { STATUS_LABELS, PIPELINE_STATUSES, TERMINAL_STATUSES, type Application, type ApplicationStatus } from '@/types';
import { filterApplications, type FilterOption } from '@/lib/applicationFilter';
import { searchApplications } from '@/lib/applicationSearch';
import { sortApplications, nextSort, type SortState, type SortKey } from '@/lib/applicationSort';
import { StatusBadge } from '@/components/StatusBadge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { X } from 'lucide-react';

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'company', label: 'Company' },
  { key: 'role', label: 'Role' },
  { key: 'status', label: 'Status' },
  { key: 'appliedAt', label: 'Applied' },
  { key: 'lastActivityAt', label: 'Last activity' },
  { key: 'salary', label: 'Salary' },
];

const selectClasses =
  'h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState | null;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort?.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={cn('px-4 py-3 text-left font-medium', className)}>
      <button
        onClick={() => onSort(sortKey)}
        className={cn(
          'group inline-flex items-center gap-1 transition-colors hover:text-foreground',
          active && 'text-foreground',
        )}
      >
        {label}
        <Icon className={cn('h-3 w-3', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-50')} />
      </button>
    </th>
  );
}

const FILTER_OPTIONS: { value: FilterOption; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'all', label: 'All' },
  ...[...PIPELINE_STATUSES, ...TERMINAL_STATUSES].map(s => ({ value: s as FilterOption, label: STATUS_LABELS[s] })),
];

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
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      {deleteConfirm === app.appId ? (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Delete?</span>
          <button onClick={() => onDelete(app.appId)}
            className="font-medium text-destructive hover:underline">Yes</button>
          <button onClick={() => setDeleteConfirm(null)}
            className="text-muted-foreground hover:underline">No</button>
        </div>
      ) : (
        <button
          onClick={() => setDeleteConfirm(app.appId)}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
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
  appliedAt: todayLocalDate(),
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
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Company *</span>
          <Input required value={form.company} onChange={set('company')} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Role *</span>
          <Input required value={form.role} onChange={set('role')} />
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Job URL</span>
        <Input type="url" value={form.jobUrl} onChange={set('jobUrl')} placeholder="https://..." />
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Status</span>
          <select value={form.status} onChange={set('status')} className={selectClasses}>
            {[...PIPELINE_STATUSES, ...TERMINAL_STATUSES].map(s => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Applied date</span>
          <Input type="date" value={form.appliedAt} onChange={set('appliedAt')} />
        </label>
      </div>

      <div className="flex flex-col gap-1.5 text-sm">
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
          <Input type="number" value={form.salaryMin} onChange={set('salaryMin')} placeholder="Min" />
          <Input type="number" value={form.salaryMax} onChange={set('salaryMax')} placeholder="Max" />
        </div>
      </div>

      {resumes.length > 0 && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Resume version</span>
          <select value={form.resumeVersionId} onChange={set('resumeVersionId')} className={selectClasses}>
            <option value="">— none —</option>
            {resumes.map(r => <option key={r.versionId} value={r.versionId}>{r.label}</option>)}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Notes</span>
        <Textarea value={form.notes} onChange={set('notes')} rows={3} placeholder="Recruiter name, referral, prep notes..." className="resize-none" />
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

function formToPayload(form: FormState) {
  const appliedAt = form.appliedAt ? calendarDateToISO(form.appliedAt) : undefined;
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

function formToUpdatePayload(form: FormState, original: Application) {
  const base = formToPayload(form);
  // appliedAt is a day-granularity field in the form. Resending it on every edit
  // rewrites the stored value to UTC midnight, discarding any time component the
  // app was created with — which drops the row to the bottom of its same-day group
  // in the table. Only send appliedAt when the user actually changed the date.
  const dateChanged = (form.appliedAt || '') !== (original.appliedAt?.slice(0, 10) ?? '');
  return {
    ...base,
    appliedAt: dateChanged ? base.appliedAt : undefined,
    // Explicitly null so the API issues a REMOVE when salary was cleared
    salaryRange: base.salaryRange ?? null,
  };
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
  const [search, setSearch] = useState('');
  // null = the resting default order (last activity desc). A column click overrides it.
  const [sort, setSort] = useState<SortState | null>(null);
  const applications = sortApplications(
    searchApplications(filterApplications(rawApplications, filter), search),
    sort,
  );
  const handleSort = (key: SortKey) => setSort(prev => nextSort(prev, key));
  const createMutation = useCreateApplication();
  const updateMutation = useUpdateApplication();
  const deleteMutation = useDeleteApplication();
  const [modal, setModal] = useState<ModalState>({ mode: 'closed' });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const handleSubmit = async (form: FormState) => {
    if (modal.mode === 'create') {
      await createMutation.mutateAsync(formToPayload(form));
    } else if (modal.mode === 'edit') {
      await updateMutation.mutateAsync({ appId: modal.app.appId, ...formToUpdatePayload(form, modal.app) });
    }
    setModal({ mode: 'closed' });
  };

  const handleDelete = async (appId: string) => {
    await deleteMutation.mutateAsync(appId);
    setDeleteConfirm(null);
  };

  const submitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="animate-fade-in p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Applications</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every role you've applied to, in one place.</p>
        </div>
        <Button onClick={() => setModal({ mode: 'create' })} className="gap-2">
          <Plus className="h-4 w-4" />
          Add application
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              filter === opt.value
                ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/30'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search company, role, or notes..."
            aria-label="Search applications"
            className="pl-9"
          />
        </div>

        {/* Mobile sort control — the desktop table sorts via clickable headers instead. */}
        <div className="flex items-center gap-2 lg:hidden">
          <select
            value={sort?.key ?? ''}
            onChange={e =>
              setSort(e.target.value ? { key: e.target.value as SortKey, dir: sort?.dir ?? 'asc' } : null)
            }
            aria-label="Sort by"
            className={selectClasses}
          >
            <option value="">Sort: Default</option>
            {SORT_COLUMNS.map(c => (
              <option key={c.key} value={c.key}>Sort: {c.label}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={!sort}
            onClick={() => sort && setSort({ key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
            aria-label="Toggle sort direction"
            className="rounded-md border border-input bg-background p-2.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            {sort?.dir === 'desc' ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : applications.length === 0 ? (
        <Card className="flex flex-col items-center justify-center border-dashed py-16 text-center">
          {rawApplications.length === 0 ? (
            <>
              <p className="text-muted-foreground">No applications yet.</p>
              <button
                onClick={() => setModal({ mode: 'create' })}
                className="mt-3 text-sm font-medium text-primary hover:underline"
              >
                Add your first one
              </button>
            </>
          ) : (
            <>
              <p className="text-muted-foreground">
                No applications match {search.trim() ? 'your search' : 'this filter'}.
              </p>
              <button
                onClick={() => { setFilter('all'); setSearch(''); }}
                className="mt-3 text-sm font-medium text-primary hover:underline"
              >
                Show all
              </button>
            </>
          )}
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-hidden p-0 lg:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  {SORT_COLUMNS.map(c => (
                    <SortHeader key={c.key} label={c.label} sortKey={c.key} sort={sort} onSort={handleSort} />
                  ))}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {applications.map(app => (
                  <tr key={app.appId} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        {app.company}
                        {app.jobUrl && (
                          <a href={app.jobUrl} target="_blank" rel="noopener noreferrer"
                            className="text-muted-foreground transition-colors hover:text-foreground">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{app.role}</td>
                    <td className="px-4 py-3"><StatusBadge status={app.status} /></td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {app.appliedAt ? formatDate(app.appliedAt) : '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {app.lastActivityAt ? formatDate(app.lastActivityAt) : '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatSalary(app)}</td>
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
          </Card>

          {/* Mobile cards */}
          <div className="space-y-3 lg:hidden">
            {applications.map(app => (
              <Card key={app.appId} className="p-4">
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
                    Applied {app.appliedAt ? formatDate(app.appliedAt) : '—'}
                    <span className="ml-2">· Active {app.lastActivityAt ? formatDate(app.lastActivityAt) : '—'}</span>
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
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Create/Edit modal — kept inline (not portaled) so it renders in the page tree */}
      {modal.mode !== 'closed' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-lg animate-fade-in overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">
                {modal.mode === 'create' ? 'Add application' : 'Edit application'}
              </h2>
              <button onClick={() => setModal({ mode: 'closed' })}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
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
