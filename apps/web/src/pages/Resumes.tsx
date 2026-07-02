import { useRef, useState } from 'react';
import { Upload, Trash2, FileText, Eye, Download } from 'lucide-react';
import { useResumes, useCreateResume, useDeleteResume, useResumeUrl } from '@/hooks/useResumes';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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

  const resumeActions = (versionId: string) => (
    <div className="flex items-center justify-end gap-1">
      <button
        onClick={() => handleView(versionId)}
        disabled={urlMutation.isPending}
        title="View PDF"
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        <Eye className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => handleDownload(versionId)}
        disabled={urlMutation.isPending}
        title="Download PDF"
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
      {deleteConfirm === versionId ? (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Delete?</span>
          <button onClick={() => handleDelete(versionId)} className="font-medium text-destructive hover:underline">Yes</button>
          <button onClick={() => setDeleteConfirm(null)} className="text-muted-foreground hover:underline">No</button>
        </div>
      ) : (
        <button
          onClick={() => setDeleteConfirm(versionId)}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <div className="animate-fade-in p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Resumes</h1>
          <p className="mt-1 text-sm text-muted-foreground">Track each variant and how well it performs.</p>
        </div>
        <Button onClick={() => setShowUpload(v => !v)} className="gap-2">
          <Upload className="h-4 w-4" />
          Upload resume
        </Button>
      </div>

      {showUpload && (
        <Card className="mb-6 animate-fade-in p-5">
          <form onSubmit={handleUpload}>
            <h2 className="mb-4 text-sm font-semibold">New resume version</h2>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <label className="flex flex-1 flex-col gap-1.5 text-sm">
                <span className="font-medium">Label</span>
                <Input
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  placeholder="e.g. Software Engineer v3"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1.5 text-sm">
                <span className="font-medium">PDF file *</span>
                <input
                  ref={fileRef}
                  required
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                  className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:mr-3 file:rounded file:border-0 file:bg-primary file:px-2 file:py-1 file:text-xs file:font-medium file:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setShowUpload(false); setLabel(''); setFile(null); }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending || !file}>
                  {createMutation.isPending ? 'Uploading...' : 'Upload'}
                </Button>
              </div>
            </div>
          </form>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : resumes.length === 0 ? (
        <Card className="flex flex-col items-center justify-center border-dashed py-16 text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FileText className="h-6 w-6" />
          </span>
          <p className="text-muted-foreground">No resume versions yet.</p>
          <button
            onClick={() => setShowUpload(true)}
            className="mt-3 text-sm font-medium text-primary hover:underline"
          >
            Upload your first one
          </button>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-hidden p-0 lg:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Label</th>
                  <th className="px-4 py-3 text-left font-medium">Uploaded</th>
                  <th className="px-4 py-3 text-left font-medium">Used in</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {resumes.map(resume => (
                  <tr key={resume.versionId} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">
                      <span className="flex items-center gap-2.5">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        {resume.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {new Date(resume.uploadedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {resume.useCount === 1 ? '1 application' : `${resume.useCount} applications`}
                    </td>
                    <td className="px-4 py-3">{resumeActions(resume.versionId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Mobile cards */}
          <div className="space-y-3 lg:hidden">
            {resumes.map(resume => (
              <Card key={resume.versionId} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="flex min-w-0 items-center gap-2 truncate font-medium">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{resume.label}</span>
                  </p>
                  {resumeActions(resume.versionId)}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(resume.uploadedAt).toLocaleDateString()} ·{' '}
                  {resume.useCount === 1 ? '1 application' : `${resume.useCount} applications`}
                </p>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
