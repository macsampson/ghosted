import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ResumeVersion } from '@/types';

const QUERY_KEY = ['resumes'];

export function useResumes() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<ResumeVersion[]>('/resumes'),
  });
}

interface UploadUrlResponse {
  resume: ResumeVersion;
  uploadUrl: string;
  fields: Record<string, string>;
}

export function useCreateResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      label,
      file,
    }: {
      label: string;
      file: File;
    }): Promise<ResumeVersion> => {
      // Step 1: get presigned URL + create the DDB record
      const { resume, uploadUrl, fields } = await api.post<UploadUrlResponse>('/resumes/upload-url', {
        label,
        filename: file.name,
        contentType: file.type || 'application/pdf',
      });

      // Step 2: upload directly to S3 (skipped in local dev — uploadUrl is a mock)
      if (!uploadUrl.includes('localhost')) {
        const form = new FormData();
        Object.entries(fields).forEach(([k, v]) => form.append(k, v));
        form.append('file', file);
        const uploadRes = await fetch(uploadUrl, { method: 'POST', body: form });
        if (!uploadRes.ok) throw new Error('Upload failed');
      }

      return resume;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useResumeUrl() {
  return useMutation({
    mutationFn: ({ versionId, download = false }: { versionId: string; download?: boolean }) =>
      api.get<{ url: string }>(`/resumes/${versionId}/url${download ? '?download=true' : ''}`),
  });
}

export function useDeleteResume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => api.delete(`/resumes/${versionId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
