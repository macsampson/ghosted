import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Application } from '@/types';

const QUERY_KEY = ['applications'];

export function useApplications() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.get<Application[]>('/applications'),
  });
}

export function useApplication(appId: string) {
  return useQuery({
    queryKey: [...QUERY_KEY, appId],
    queryFn: () => api.get<Application>(`/applications/${appId}`),
    enabled: !!appId,
  });
}

export function useCreateApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Application>) => api.post<Application>('/applications', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}

export function useUpdateApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ appId, ...data }: Omit<Partial<Application>, 'salaryRange'> & { appId: string; salaryRange?: Application['salaryRange'] | null }) =>
      api.put<Application>(`/applications/${appId}`, data),
    onSuccess: (_, { appId }) => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      qc.invalidateQueries({ queryKey: [...QUERY_KEY, appId] });
    },
  });
}

export function useDeleteApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) => api.delete(`/applications/${appId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
