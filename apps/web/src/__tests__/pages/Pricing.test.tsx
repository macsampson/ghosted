import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pricing } from '@/pages/Pricing';
import { renderWithProviders } from '../test-utils';

const getUser = vi.fn();
const startGoogleSignIn = vi.fn();
vi.mock('@/lib/auth', () => ({
  getUser: () => getUser(),
  startGoogleSignIn: (...a: unknown[]) => startGoogleSignIn(...a),
}));

const useProfile = vi.fn();
vi.mock('@/hooks/useEmails', () => ({ useProfile: (...a: unknown[]) => useProfile(...a) }));

const startCheckout = vi.fn();
const openPortal = vi.fn();
vi.mock('@/hooks/useBilling', () => ({
  useStartCheckout: () => ({ mutate: startCheckout, isPending: false }),
  useOpenPortal: () => ({ mutate: openPortal, isPending: false }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useProfile.mockReturnValue({ data: undefined });
});

describe('Pricing', () => {
  it('renders both tiers with prices and features', async () => {
    getUser.mockRejectedValue(new Error('signed out'));
    renderWithProviders(<Pricing />);

    expect(screen.getByText('Free')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('$5')).toBeInTheDocument();
    expect(screen.getByText('Unlimited applications')).toBeInTheDocument();
    expect(screen.getByText('Most popular')).toBeInTheDocument();
  });

  it('routes a signed-out visitor to sign-in when clicking Get Pro', async () => {
    getUser.mockRejectedValue(new Error('signed out'));
    renderWithProviders(<Pricing />);
    await waitFor(() => expect(getUser).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'Get Pro' }));
    expect(startGoogleSignIn).toHaveBeenCalled();
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it('starts checkout for a signed-in free user', async () => {
    getUser.mockResolvedValue({ sub: 'u1' });
    useProfile.mockReturnValue({ data: { plan: 'free' } });
    renderWithProviders(<Pricing />);

    const btn = await screen.findByRole('button', { name: 'Get Pro' });
    await userEvent.click(btn);
    expect(startCheckout).toHaveBeenCalled();
    expect(startGoogleSignIn).not.toHaveBeenCalled();
  });

  it('opens the billing portal for a pro user', async () => {
    getUser.mockResolvedValue({ sub: 'u1' });
    useProfile.mockReturnValue({ data: { plan: 'pro' } });
    renderWithProviders(<Pricing />);

    const btn = await screen.findByRole('button', { name: 'Manage subscription' });
    await userEvent.click(btn);
    expect(openPortal).toHaveBeenCalled();
  });

  it('shows a notice when checkout was canceled', async () => {
    getUser.mockRejectedValue(new Error('signed out'));
    renderWithProviders(<Pricing />, { route: '/pricing?billing=cancel' });
    expect(screen.getByText(/checkout canceled/i)).toBeInTheDocument();
  });
});
