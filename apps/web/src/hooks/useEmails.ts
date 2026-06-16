import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { EmailEvent } from '@/types';

const EMAILS_KEY = ['emails'];
const PROFILE_KEY = ['profile'];

export interface UserProfile {
  sub: string;
  email?: string;
  gmailConnected: boolean;
  plan: 'free' | 'pro';
  subscriptionStatus: string | null;
  currentPeriodEnd: number | null;
  usage: {
    applications: number;
    resumes: number;
    classifications: number;
  };
  limits: {
    applications: number;
    resumes: number;
    classificationsPerMonth: number;
  };
}

export function useProfile(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: PROFILE_KEY,
    queryFn: () => api.get<UserProfile>('/profile'),
    enabled: options?.enabled,
  });
}

export function useStartGmailAuth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ connected?: boolean; mock?: boolean; authUrl?: string }>('/auth/gmail/start', {}),
    onSuccess: async (data) => {
      if (data.connected) {
        await qc.invalidateQueries({ queryKey: PROFILE_KEY });
      } else if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    },
  });
}

export function useEmails(needsReview = false) {
  return useQuery({
    queryKey: [...EMAILS_KEY, { needsReview }],
    queryFn: () =>
      api.get<EmailEvent[]>(`/emails${needsReview ? '?needsReview=true' : ''}`),
  });
}

export function useConfirmEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (emailId: string) => api.post<{ confirmed: boolean }>(`/emails/${emailId}/confirm`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: EMAILS_KEY });
      qc.invalidateQueries({ queryKey: ['applications'] });
    },
  });
}

export function useDismissEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (emailId: string) => api.post<{ dismissed: boolean }>(`/emails/${emailId}/dismiss`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: EMAILS_KEY }),
  });
}
