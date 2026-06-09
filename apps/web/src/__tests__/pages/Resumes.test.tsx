import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Resumes } from '@/pages/Resumes';
import { renderWithProviders, makeResume } from '../test-utils';

const useResumes = vi.fn();
const createAsync = vi.fn();
const deleteAsync = vi.fn();
const urlAsync = vi.fn();
vi.mock('@/hooks/useResumes', () => ({
  useResumes: () => useResumes(),
  useCreateResume: () => ({ mutateAsync: createAsync, isPending: false }),
  useDeleteResume: () => ({ mutateAsync: deleteAsync, isPending: false }),
  useResumeUrl: () => ({ mutateAsync: urlAsync, isPending: false }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  createAsync.mockResolvedValue(makeResume());
  deleteAsync.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('Resumes', () => {
  it('shows a spinner while loading', () => {
    useResumes.mockReturnValue({ data: [], isLoading: true });
    const { container } = renderWithProviders(<Resumes />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows the empty state and toggles the upload form', async () => {
    useResumes.mockReturnValue({ data: [], isLoading: false });
    renderWithProviders(<Resumes />);
    expect(screen.getByText('No resume versions yet.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /upload your first one/i }));
    expect(screen.getByText('New resume version')).toBeInTheDocument();
  });

  it('uploads a file, defaulting the label to the filename', async () => {
    useResumes.mockReturnValue({ data: [], isLoading: false });
    const { container } = renderWithProviders(<Resumes />);
    await userEvent.click(screen.getByRole('button', { name: /^upload resume$/i }));

    const file = new File(['%PDF'], 'My Resume.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);
    // jsdom doesn't translate a submit-button click into a submit event reliably.
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(createAsync).toHaveBeenCalledWith({ label: 'My Resume', file }));
  });

  it('renders resume rows with pluralized usage counts', () => {
    useResumes.mockReturnValue({
      data: [makeResume({ label: 'Single', useCount: 1 }), makeResume({ label: 'Many', useCount: 3 })],
      isLoading: false,
    });
    renderWithProviders(<Resumes />);
    expect(screen.getAllByText('1 application').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3 applications').length).toBeGreaterThan(0);
  });

  it('opens a resume in a new tab on view', async () => {
    useResumes.mockReturnValue({ data: [makeResume({ versionId: 'r1' })], isLoading: false });
    urlAsync.mockResolvedValue({ url: 'https://signed/view' });
    const openSpy = vi.fn();
    vi.stubGlobal('open', openSpy);
    renderWithProviders(<Resumes />);

    await userEvent.click(screen.getAllByTitle('View PDF')[0]);
    await waitFor(() => expect(urlAsync).toHaveBeenCalledWith({ versionId: 'r1' }));
    expect(openSpy).toHaveBeenCalledWith('https://signed/view', '_blank', 'noopener,noreferrer');
  });

  it('triggers a download via an anchor on download', async () => {
    useResumes.mockReturnValue({ data: [makeResume({ versionId: 'r1' })], isLoading: false });
    urlAsync.mockResolvedValue({ url: 'https://signed/dl' });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderWithProviders(<Resumes />);

    await userEvent.click(screen.getAllByTitle('Download PDF')[0]);
    await waitFor(() => expect(urlAsync).toHaveBeenCalledWith({ versionId: 'r1', download: true }));
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('deletes a resume after confirmation', async () => {
    useResumes.mockReturnValue({ data: [makeResume({ versionId: 'r1' })], isLoading: false });
    const { container } = renderWithProviders(<Resumes />);

    // First trash click reveals the confirm prompt.
    const trash = container.querySelector('.lucide-trash2')!.closest('button')!;
    await userEvent.click(trash);
    await userEvent.click(screen.getAllByRole('button', { name: 'Yes' })[0]);
    expect(deleteAsync).toHaveBeenCalledWith('r1');
  });
});
