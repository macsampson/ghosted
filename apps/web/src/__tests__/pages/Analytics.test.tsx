import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Analytics } from '@/pages/Analytics';
import { renderWithProviders, makeApp, makeResume } from '../test-utils';
import type { StatusEvent } from '@/types';

const useApplications = vi.fn();
const useResumes = vi.fn();
vi.mock('@/hooks/useApplications', () => ({ useApplications: () => useApplications() }));
vi.mock('@/hooks/useResumes', () => ({ useResumes: () => useResumes() }));

function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400_000).toISOString();
}
function history(...steps: [StatusEvent['status'], number][]): StatusEvent[] {
  return steps.map(([status, d]) => ({ status, at: daysAgo(d), source: 'manual' as const }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useResumes.mockReturnValue({ data: [] });
});

describe('Analytics', () => {
  it('shows a spinner while loading', () => {
    useApplications.mockReturnValue({ data: [], isLoading: true });
    const { container } = renderWithProviders(<Analytics />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows the empty state with no applications', () => {
    useApplications.mockReturnValue({ data: [], isLoading: false });
    renderWithProviders(<Analytics />);
    expect(screen.getByText(/no applications yet/i)).toBeInTheDocument();
  });

  it('renders the overall funnel and section headers', () => {
    useApplications.mockReturnValue({
      data: [
        makeApp({ status: 'screening', statusHistory: history(['applied', 10], ['screening', 7]) }),
        makeApp({ status: 'applied' }),
      ],
      isLoading: false,
    });
    renderWithProviders(<Analytics />);
    // Appears in both the funnel card and the stage-to-stage conversion section.
    expect(screen.getAllByText('All applications').length).toBeGreaterThan(0);
    expect(screen.getByText(/funnel drop-off by resume variant/i)).toBeInTheDocument();
    expect(screen.getByText(/where each variant loses momentum/i)).toBeInTheDocument();
    expect(screen.getByText(/application velocity/i)).toBeInTheDocument();
  });

  it('omits the always-100% Applied baseline band from the funnel, keeping Screening', () => {
    useApplications.mockReturnValue({
      data: [
        makeApp({ status: 'screening', statusHistory: history(['applied', 10], ['screening', 7]) }),
        makeApp({ status: 'applied' }),
      ],
      isLoading: false,
    });
    renderWithProviders(<Analytics />);
    // The funnel band labelled exactly "Applied" is gone (it was always 100% of n).
    // "Applied → Screening" in the conversion section is combined text, so it does
    // not match the exact "Applied" query.
    expect(screen.queryByText('Applied')).not.toBeInTheDocument();
    expect(screen.getByText('Screening')).toBeInTheDocument();
  });

  it('shows the backfill warning banner when history was backfilled', () => {
    useApplications.mockReturnValue({
      data: [makeApp({ status: 'rejected', statusHistory: [{ status: 'rejected', at: daysAgo(3), source: 'backfill' }] })],
      isLoading: false,
    });
    renderWithProviders(<Analytics />);
    expect(screen.getByText(/tracked before per-transition history existed/i)).toBeInTheDocument();
  });

  it('shows the time-to-first-response table when a variant has responses', () => {
    const resume = makeResume({ versionId: 'r1', label: 'SWE v1' });
    useResumes.mockReturnValue({ data: [resume] });
    useApplications.mockReturnValue({
      data: [
        makeApp({
          status: 'phone_interview',
          resumeVersionId: 'r1',
          statusHistory: history(['applied', 20], ['screening', 15], ['phone_interview', 10]),
        }),
      ],
      isLoading: false,
    });
    renderWithProviders(<Analytics />);
    expect(screen.getByText(/time to first response by variant/i)).toBeInTheDocument();
  });
});
