import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmailReview } from '@/pages/EmailReview';
import { renderWithProviders, makeEmail } from '../test-utils';

const useEmails = vi.fn();
const confirmMutate = vi.fn();
const dismissMutate = vi.fn();
vi.mock('@/hooks/useEmails', () => ({
  useEmails: () => useEmails(),
  useConfirmEmail: () => ({ mutate: confirmMutate, isPending: false }),
  useDismissEmail: () => ({ mutate: dismissMutate, isPending: false }),
}));

beforeEach(() => vi.clearAllMocks());

describe('EmailReview', () => {
  it('shows a spinner while loading', () => {
    useEmails.mockReturnValue({ data: [], isLoading: true });
    const { container } = renderWithProviders(<EmailReview />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows the empty state when no emails need review', () => {
    useEmails.mockReturnValue({ data: [], isLoading: false });
    renderWithProviders(<EmailReview />);
    expect(screen.getByText('All caught up')).toBeInTheDocument();
  });

  it('renders email details including classification and suggested status', () => {
    useEmails.mockReturnValue({
      data: [makeEmail({ subject: 'Interview invite', sender: 'hr@corp.com', suggestedStatus: 'phone_interview' })],
      isLoading: false,
    });
    renderWithProviders(<EmailReview />);
    // Subject/sender render in both the desktop row and mobile card.
    expect(screen.getAllByText('Interview invite').length).toBeGreaterThan(0);
    expect(screen.getAllByText('hr@corp.com').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Interview request').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Phone Interview').length).toBeGreaterThan(0);
  });

  it('falls back to (no subject) when the subject is empty', () => {
    useEmails.mockReturnValue({ data: [makeEmail({ subject: '' })], isLoading: false });
    renderWithProviders(<EmailReview />);
    expect(screen.getAllByText('(no subject)').length).toBeGreaterThan(0);
  });

  it('truncates long snippets with an ellipsis', () => {
    const long = 'x'.repeat(120);
    useEmails.mockReturnValue({ data: [makeEmail({ snippet: long })], isLoading: false });
    renderWithProviders(<EmailReview />);
    const truncated = 'x'.repeat(80) + '…';
    expect(screen.getAllByText(truncated).length).toBeGreaterThan(0);
  });

  it('confirms an email by gmailMsgId', async () => {
    useEmails.mockReturnValue({ data: [makeEmail({ gmailMsgId: 'g-1' })], isLoading: false });
    renderWithProviders(<EmailReview />);
    await userEvent.click(screen.getAllByRole('button', { name: /confirm/i })[0]);
    expect(confirmMutate).toHaveBeenCalledWith('g-1');
  });

  it('dismisses an email by gmailMsgId', async () => {
    useEmails.mockReturnValue({ data: [makeEmail({ gmailMsgId: 'g-2' })], isLoading: false });
    renderWithProviders(<EmailReview />);
    await userEvent.click(screen.getAllByRole('button', { name: /dismiss/i })[0]);
    expect(dismissMutate).toHaveBeenCalledWith('g-2');
  });

  it('shows the action summary and deadline for a follow_up_needed email', () => {
    useEmails.mockReturnValue({
      data: [makeEmail({
        classification: 'follow_up_needed',
        actionSummary: 'Complete the coding assessment',
        actionDeadline: '2026-06-15',
        suggestedStatus: undefined,
      })],
      isLoading: false,
    });
    renderWithProviders(<EmailReview />);
    expect(screen.getAllByText('Complete the coding assessment').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/due/i).length).toBeGreaterThan(0);
  });

  it('offers "Mark done" instead of confirm for a follow-up with no suggested status', async () => {
    useEmails.mockReturnValue({
      data: [makeEmail({ gmailMsgId: 'g-3', classification: 'follow_up_needed', suggestedStatus: undefined, actionSummary: 'Send references' })],
      isLoading: false,
    });
    renderWithProviders(<EmailReview />);
    expect(screen.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: /mark done/i })[0]);
    expect(dismissMutate).toHaveBeenCalledWith('g-3');
  });

  it('keeps the confirm action for a recruiter-screen follow-up with a suggested status', () => {
    useEmails.mockReturnValue({
      data: [makeEmail({ classification: 'follow_up_needed', suggestedStatus: 'screening', actionSummary: 'Reply to schedule a screen' })],
      isLoading: false,
    });
    renderWithProviders(<EmailReview />);
    expect(screen.getAllByRole('button', { name: /confirm/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Screening').length).toBeGreaterThan(0);
  });
});
