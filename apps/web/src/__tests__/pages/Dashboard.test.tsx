import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Dashboard } from '@/pages/Dashboard';
import { renderWithProviders, makeApp, makeResume, makeEmail } from '../test-utils';

const useApplications = vi.fn();
const useResumes = vi.fn();
const useEmails = vi.fn();
vi.mock('@/hooks/useApplications', () => ({ useApplications: () => useApplications() }));
vi.mock('@/hooks/useResumes', () => ({ useResumes: () => useResumes() }));
vi.mock('@/hooks/useEmails', () => ({ useEmails: () => useEmails() }));

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400_000).toISOString();
}

beforeEach(() => {
  vi.clearAllMocks();
  useResumes.mockReturnValue({ data: [] });
  useEmails.mockReturnValue({ data: [] });
});

describe('Dashboard', () => {
  it('shows a spinner while applications load', () => {
    useApplications.mockReturnValue({ data: [], isLoading: true });
    const { container } = renderWithProviders(<Dashboard />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows the empty state with no applications', () => {
    useApplications.mockReturnValue({ data: [], isLoading: false });
    renderWithProviders(<Dashboard />);
    expect(screen.getByText(/no applications yet/i)).toBeInTheDocument();
  });

  it('renders summary stats and the pipeline funnel', () => {
    useApplications.mockReturnValue({
      data: [
        makeApp({ status: 'applied' }),
        makeApp({ status: 'screening' }),
        makeApp({ status: 'rejected' }),
      ],
      isLoading: false,
    });
    renderWithProviders(<Dashboard />);
    expect(screen.getByText('Total applications')).toBeInTheDocument();
    expect(screen.getByText('Active in pipeline')).toBeInTheDocument();
    expect(screen.getByText('Pipeline funnel')).toBeInTheDocument();
    // Reached screening+ stat shows "n of total".
    expect(screen.getByText('Reached screening+')).toBeInTheDocument();
  });

  it('shows the resume performance section when resumes exist', () => {
    useResumes.mockReturnValue({ data: [makeResume({ label: 'SWE v2' })] });
    useApplications.mockReturnValue({ data: [makeApp({ status: 'applied' })], isLoading: false });
    renderWithProviders(<Dashboard />);
    expect(screen.getByText('Resume performance')).toBeInTheDocument();
  });

  it('lists stale applications with no activity in 14+ days', () => {
    useApplications.mockReturnValue({
      data: [makeApp({ company: 'StaleCo', status: 'applied', lastActivityAt: daysAgo(30) })],
      isLoading: false,
    });
    renderWithProviders(<Dashboard />);
    expect(screen.getByText(/stale applications/i)).toBeInTheDocument();
    expect(screen.getAllByText('StaleCo').length).toBeGreaterThan(0);
  });

  it('surfaces an action-needed widget for follow_up_needed emails', () => {
    const app = makeApp({ company: 'Datadog', role: 'SWE' });
    useApplications.mockReturnValue({ data: [app], isLoading: false });
    useEmails.mockReturnValue({
      data: [makeEmail({
        classification: 'follow_up_needed',
        applicationId: app.appId,
        actionSummary: 'Complete the coding assessment',
        actionDeadline: '2026-06-20',
      })],
    });
    renderWithProviders(<Dashboard />);
    expect(screen.getAllByText(/action needed/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Complete the coding assessment')).toBeInTheDocument();
  });

  it('omits the action-needed section when there are no follow-up emails', () => {
    useApplications.mockReturnValue({ data: [makeApp({ status: 'applied' })], isLoading: false });
    useEmails.mockReturnValue({ data: [makeEmail({ classification: 'interview_request' })] });
    renderWithProviders(<Dashboard />);
    expect(screen.queryByText('Complete the coding assessment')).not.toBeInTheDocument();
  });
});
