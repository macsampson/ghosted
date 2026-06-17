import type { Application, ApplicationStatus } from '@/types';

export type FilterOption = 'active' | 'all' | ApplicationStatus;

export const ACTIVE_STATUSES = new Set<ApplicationStatus>([
  'applied', 'screening', 'online_assessment', 'phone_interview', 'technical_interview', 'onsite', 'offer', 'accepted',
]);

export function filterApplications(apps: Application[], filter: FilterOption): Application[] {
  return apps.filter(app => {
    if (filter === 'all') return true;
    if (filter === 'active') return ACTIVE_STATUSES.has(app.status);
    return app.status === filter;
  });
}
