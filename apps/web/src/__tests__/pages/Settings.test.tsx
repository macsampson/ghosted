import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from '@/pages/Settings';
import { renderWithProviders, createTestQueryClient } from '../test-utils';

const useProfile = vi.fn();
const startGmailAuth = vi.fn();
const useStartGmailAuth = vi.fn(() => ({ mutate: startGmailAuth, isPending: false }));
vi.mock('@/hooks/useEmails', () => ({
  useProfile: () => useProfile(),
  useStartGmailAuth: () => useStartGmailAuth(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useStartGmailAuth.mockReturnValue({ mutate: startGmailAuth, isPending: false });
});

describe('Settings', () => {
  it('shows a loading state while the profile loads', () => {
    useProfile.mockReturnValue({ data: undefined, isLoading: true });
    renderWithProviders(<Settings />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows connected state with a reconnect button that starts auth', async () => {
    useProfile.mockReturnValue({ data: { gmailConnected: true }, isLoading: false });
    renderWithProviders(<Settings />);

    expect(screen.getByText('Gmail connected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /reconnect/i }));
    expect(startGmailAuth).toHaveBeenCalledOnce();
  });

  it('shows a connect button when not connected', async () => {
    useProfile.mockReturnValue({ data: { gmailConnected: false }, isLoading: false });
    renderWithProviders(<Settings />);

    await userEvent.click(screen.getByRole('button', { name: /connect gmail/i }));
    expect(startGmailAuth).toHaveBeenCalledOnce();
  });

  it('renders the special no_refresh_token error message', () => {
    useProfile.mockReturnValue({ data: { gmailConnected: false }, isLoading: false });
    renderWithProviders(<Settings />, { route: '/settings?error=no_refresh_token' });
    expect(screen.getByText(/did not return a refresh token/i)).toBeInTheDocument();
  });

  it('renders a generic OAuth error message', () => {
    useProfile.mockReturnValue({ data: { gmailConnected: false }, isLoading: false });
    renderWithProviders(<Settings />, { route: '/settings?error=access_denied' });
    expect(screen.getByText(/connection failed: access_denied/i)).toBeInTheDocument();
  });

  it('invalidates the profile when redirected back with connected=true', async () => {
    useProfile.mockReturnValue({ data: { gmailConnected: true }, isLoading: false });
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    renderWithProviders(<Settings />, { route: '/settings?connected=true', client });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['profile'] }));
  });
});
