import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from '@/pages/Settings';
import { renderWithProviders } from '../test-utils';

const useProfile = vi.fn();
vi.mock('@/hooks/useEmails', () => ({
  useProfile: () => useProfile(),
  useStartGmailAuth: () => ({ mutate: vi.fn(), isPending: false }),
}));

const startCheckout = vi.fn();
const openPortal = vi.fn();
vi.mock('@/hooks/useBilling', () => ({
  useStartCheckout: () => ({ mutate: startCheckout, isPending: false }),
  useOpenPortal: () => ({ mutate: openPortal, isPending: false }),
}));

const freeProfile = {
  gmailConnected: false,
  plan: 'free',
  usage: { applications: 3, resumes: 1, classifications: 7 },
  limits: { applications: 25, resumes: 1, classificationsPerMonth: 20 },
};

beforeEach(() => vi.clearAllMocks());

describe('Settings billing section', () => {
  it('shows usage and an upgrade button for a free user', async () => {
    useProfile.mockReturnValue({ data: freeProfile, isLoading: false });
    renderWithProviders(<Settings />);

    expect(screen.getByText('Free plan')).toBeInTheDocument();
    expect(screen.getByText('Applications: 3 / 25')).toBeInTheDocument();
    expect(screen.getByText('AI email scans this month: 7 / 20')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /upgrade to pro/i }));
    expect(startCheckout).toHaveBeenCalledOnce();
  });

  it('shows a manage-billing button for a pro user', async () => {
    useProfile.mockReturnValue({ data: { ...freeProfile, plan: 'pro' }, isLoading: false });
    renderWithProviders(<Settings />);

    expect(screen.getByText(/unlimited everything/i)).toBeInTheDocument();
    expect(screen.queryByText('Applications: 3 / 25')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /manage billing/i }));
    expect(openPortal).toHaveBeenCalledOnce();
  });
});
