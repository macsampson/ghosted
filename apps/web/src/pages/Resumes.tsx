import { useRef, useState } from 'react';
import { Upload, Trash2, FileText, Eye, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useResumes, useCreateResume, useDeleteResume, useResumeUrl } from '@/hooks/useResumes';

export function Resumes() {
  const { data: resumes = [], isLoading } = useResumes();
  const createMutation = useCreateResume();
  const deleteMutation = useDeleteResume();
  const urlMutation = useResumeUrl();

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    await createMutation.mutateAsync({ label: label || file.name.replace(/\.pdf$/i, ''), file });
    setShowUpload(false);
    setLabel('');
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleView = async (versionId: string) => {
    const { url } = await urlMutation.mutateAsync({ versionId });
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleDownload = async (versionId: string) => {
    const { url } = await urlMutation.mutateAsync({ versionId, download: true });
    const a = document.createElement('a');
    a.href = url;
    a.click();
  };

  const handleDelete = async (versionId: string) => {
    await deleteMutation.mutateAsync(versionId);
    setDeleteConfirm(null);
  };

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Resumes</h1>
        <button
          onClick={() => setShowUpload(v => !v)}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Upload className="h-4 w-4" />
          Upload resume
        </button>
      </div>

      {showUpload && (
        <form
          onSubmit={handleUpload}
          className="mb-6 rounded-lg border border-border bg-card p-5"
        >
          <h2 className="mb-4 text-sm font-semibold">New resume version</h2>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="font-medium">Label</span>
              <input
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="e.g. Software Engineer v3"
                className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="font-medium">PDF file *</span>
              <input
                ref={fileRef}
                required
                type="file"
                accept="application/pdf,.pdf"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-primary file:px-2 file:py-1 file:text-xs file:font-medium file:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setShowUpload(false); setLabel(''); setFile(null); }}
                className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending || !file}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : resumes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <FileText className="mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="text-muted-foreground">No resume versions yet.</p>
          <button
            onClick={() => setShowUpload(true)}
            className="mt-3 text-sm text-primary hover:underline"
          >
            Upload your first one
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Label</th>
                <th className="px-4 py-3 text-left font-medium">Uploaded</th>
                <th className="px-4 py-3 text-left font-medium">Used in</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {resumes.map(resume => (
                <tr key={resume.versionId} className={cn('bg-card transition-colors hover:bg-muted/30')}>
                  <td className="px-4 py-3 font-medium">{resume.label}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(resume.uploadedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {resume.useCount === 1 ? '1 application' : `${resume.useCount} applications`}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleView(resume.versionId)}
                        disabled={urlMutation.isPending}
                        title="View PDF"
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDownload(resume.versionId)}
                        disabled={urlMutation.isPending}
                        title="Download PDF"
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      {deleteConfirm === resume.versionId ? (
                        <div className="flex items-center gap-1 text-xs">
                          <span className="text-muted-foreground">Delete?</span>
                          <button
                            onClick={() => handleDelete(resume.versionId)}
                            className="font-medium text-destructive hover:underline"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="text-muted-foreground hover:underline"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(resume.versionId)}
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
