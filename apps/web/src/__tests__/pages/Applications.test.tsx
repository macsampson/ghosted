import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Applications } from '@/pages/Applications';
import { renderWithProviders, makeApp } from '../test-utils';

const useApplications = vi.fn();
const createAsync = vi.fn();
const updateAsync = vi.fn();
const deleteAsync = vi.fn();
vi.mock('@/hooks/useApplications', () => ({
  useApplications: () => useApplications(),
  useCreateApplication: () => ({ mutateAsync: createAsync, isPending: false }),
  useUpdateApplication: () => ({ mutateAsync: updateAsync, isPending: false }),
  useDeleteApplication: () => ({ mutateAsync: deleteAsync, isPending: false }),
}));
vi.mock('@/hooks/useResumes', () => ({ useResumes: () => ({ data: [] }) }));

beforeEach(() => {
  vi.clearAllMocks();
  createAsync.mockResolvedValue(makeApp());
  updateAsync.mockResolvedValue(makeApp());
  deleteAsync.mockResolvedValue(undefined);
});

describe('Applications', () => {
  it('shows a spinner while loading', () => {
    useApplications.mockReturnValue({ data: [], isLoading: true });
    const { container } = renderWithProviders(<Applications />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows the first-run empty state when there are no applications', () => {
    useApplications.mockReturnValue({ data: [], isLoading: false });
    renderWithProviders(<Applications />);
    expect(screen.getByText('No applications yet.')).toBeInTheDocument();
  });

  it('shows a filter-empty state when apps exist but none match, and "Show all" reveals them', async () => {
    useApplications.mockReturnValue({
      data: [makeApp({ company: 'Rejected Co', status: 'rejected' })],
      isLoading: false,
    });
    renderWithProviders(<Applications />);
    // Default filter is "active", which excludes rejected.
    expect(screen.getByText('No applications match this filter.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getAllByText('Rejected Co').length).toBeGreaterThan(0);
  });

  it('renders application rows with formatted salary', () => {
    useApplications.mockReturnValue({
      data: [
        makeApp({ company: 'Acme', role: 'Engineer', status: 'applied', salaryRange: { min: 120000, max: 160000, currency: 'USD' } }),
        makeApp({ company: 'NoPay', role: 'Intern', status: 'applied' }),
      ],
      isLoading: false,
    });
    renderWithProviders(<Applications />);
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$120k–$160k').length).toBeGreaterThan(0);
    // No salary renders an em dash.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('creates an application from the modal form', async () => {
    useApplications.mockReturnValue({ data: [], isLoading: false });
    const { container } = renderWithProviders(<Applications />);

    await userEvent.click(screen.getByRole('button', { name: /add application/i }));
    expect(screen.getByText('Add application', { selector: 'h2' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/company/i), 'Acme');
    await userEvent.type(screen.getByLabelText(/^role/i), 'Engineer');
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(createAsync).toHaveBeenCalledTimes(1));
    expect(createAsync).toHaveBeenCalledWith(
      expect.objectContaining({ company: 'Acme', role: 'Engineer', status: 'applied' }),
    );
  });

  it('edits an existing application', async () => {
    const app = makeApp({ appId: 'a1', company: 'Acme', role: 'Engineer' });
    useApplications.mockReturnValue({ data: [app], isLoading: false });
    const { container } = renderWithProviders(<Applications />);

    // Open the edit modal from the first (desktop) row's pencil button.
    const editBtn = container.querySelector('.lucide-pencil')!.closest('button')!;
    await userEvent.click(editBtn);
    expect(screen.getByText('Edit application', { selector: 'h2' })).toBeInTheDocument();

    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(1));
    expect(updateAsync.mock.calls[0][0]).toMatchObject({ appId: 'a1', company: 'Acme' });
  });

  it('does not resend appliedAt when the date was not changed (preserves row order)', async () => {
    // appliedAt is stored with a time component; the form only edits the day. Resending
    // it on an unrelated edit would rewrite the timestamp to UTC midnight and reshuffle
    // the row among same-day apps, so an unchanged date must be omitted from the update.
    const app = makeApp({ appId: 'a1', company: 'Acme', appliedAt: '2026-06-18T14:30:00.000Z' });
    useApplications.mockReturnValue({ data: [app], isLoading: false });
    const { container } = renderWithProviders(<Applications />);

    const editBtn = container.querySelector('.lucide-pencil')!.closest('button')!;
    await userEvent.click(editBtn);
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(1));
    expect(updateAsync.mock.calls[0][0].appliedAt).toBeUndefined();
  });

  it('sends appliedAt anchored at noon UTC of the new date when the date was changed', async () => {
    const app = makeApp({ appId: 'a1', appliedAt: '2026-06-18T12:00:00.000Z' });
    useApplications.mockReturnValue({ data: [app], isLoading: false });
    const { container } = renderWithProviders(<Applications />);

    const editBtn = container.querySelector('.lucide-pencil')!.closest('button')!;
    await userEvent.click(editBtn);
    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-06-10' } });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(1));
    // Noon UTC, not midnight, so the date renders to the same calendar day locally.
    expect(updateAsync.mock.calls[0][0].appliedAt).toBe('2026-06-10T12:00:00.000Z');
  });

  it('orders same-day applications by creation time, independent of the appliedAt time', () => {
    // Both applied on the same day. NewerCo was created later in the day but has an
    // earlier appliedAt time (midnight, as a form-created app does); OlderCo was created
    // earlier but has a later appliedAt time. The stable createdAt tiebreak must put the
    // most-recently-added row (NewerCo) on top regardless of the appliedAt time component.
    useApplications.mockReturnValue({
      data: [
        makeApp({ appId: 'older', company: 'OlderCo', appliedAt: '2026-06-18T23:00:00.000Z', createdAt: '2026-06-18T09:00:00.000Z' }),
        makeApp({ appId: 'newer', company: 'NewerCo', appliedAt: '2026-06-18T00:00:00.000Z', createdAt: '2026-06-18T14:00:00.000Z' }),
      ],
      isLoading: false,
    });
    const { container } = renderWithProviders(<Applications />);
    const rowText = [...container.querySelectorAll('tbody tr')].map(tr => tr.textContent ?? '');
    const newerIdx = rowText.findIndex(t => t.includes('NewerCo'));
    const olderIdx = rowText.findIndex(t => t.includes('OlderCo'));
    expect(newerIdx).toBeGreaterThanOrEqual(0);
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  it('sorts more recent applied dates above older ones', () => {
    useApplications.mockReturnValue({
      data: [
        makeApp({ appId: 'old', company: 'OldDay', appliedAt: '2026-06-01T00:00:00.000Z', createdAt: '2026-06-01T10:00:00.000Z' }),
        makeApp({ appId: 'new', company: 'NewDay', appliedAt: '2026-06-18T00:00:00.000Z', createdAt: '2026-06-02T10:00:00.000Z' }),
      ],
      isLoading: false,
    });
    const { container } = renderWithProviders(<Applications />);
    const rowText = [...container.querySelectorAll('tbody tr')].map(tr => tr.textContent ?? '');
    const newIdx = rowText.findIndex(t => t.includes('NewDay'));
    const oldIdx = rowText.findIndex(t => t.includes('OldDay'));
    expect(newIdx).toBeLessThan(oldIdx);
  });

  it('deletes an application after confirmation', async () => {
    useApplications.mockReturnValue({ data: [makeApp({ appId: 'a1' })], isLoading: false });
    const { container } = renderWithProviders(<Applications />);

    const trash = container.querySelector('.lucide-trash2')!.closest('button')!;
    await userEvent.click(trash);
    await userEvent.click(screen.getAllByRole('button', { name: 'Yes' })[0]);
    await waitFor(() => expect(deleteAsync).toHaveBeenCalledWith('a1'));
  });

  it('closes the modal via the cancel button', async () => {
    useApplications.mockReturnValue({ data: [], isLoading: false });
    renderWithProviders(<Applications />);
    await userEvent.click(screen.getByRole('button', { name: /add application/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Add application', { selector: 'h2' })).not.toBeInTheDocument();
  });
});
