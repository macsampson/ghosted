import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// vi.mock factories are hoisted above normal consts, so shared spies must be
// created with vi.hoisted to exist when the mocks (and App's module-load Hub
// registration) run.
const h = vi.hoisted(() => {
  const holder: { authHandler: (e: { payload: { event: string } }) => void } = { authHandler: () => {} };
  return {
    holder,
    hubListen: vi.fn((_channel: string, cb: (e: { payload: { event: string } }) => void) => {
      holder.authHandler = cb;
    }),
    navigate: vi.fn(),
    getUser: vi.fn(),
  };
});

vi.mock('aws-amplify/utils', () => ({ Hub: { listen: h.hubListen } }));
vi.mock('@/router', () => ({ router: { navigate: h.navigate } }));
vi.mock('react-router-dom', () => ({ RouterProvider: () => <div>router</div> }));
vi.mock('@tanstack/react-query-devtools', () => ({ ReactQueryDevtools: () => null }));
vi.mock('@/lib/auth', () => ({ getUser: () => h.getUser() }));

import App from '@/App';

const { hubListen, navigate, getUser } = h;
const fireAuth = (event: string) => h.holder.authHandler({ payload: { event } });

beforeEach(() => {
  // Don't clear hubListen — the listener is registered once at module import.
  navigate.mockClear();
  getUser.mockClear();
});

describe('App', () => {
  it('registers a Hub auth listener that navigates on auth events', () => {
    getUser.mockRejectedValue(new Error('no session'));
    render(<App />);

    expect(hubListen).toHaveBeenCalledWith('auth', expect.any(Function));

    fireAuth('signedIn');
    expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true });

    fireAuth('signedOut');
    expect(navigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('redirects an authenticated user from the login/root path to the dashboard', async () => {
    window.history.pushState({}, '', '/login');
    getUser.mockResolvedValue({ sub: 'u1' });
    render(<App />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/dashboard', { replace: true }));
  });

  it('does not redirect an authenticated user already on a deep route', async () => {
    window.history.pushState({}, '', '/applications');
    getUser.mockResolvedValue({ sub: 'u1' });
    render(<App />);
    // Give the effect a tick; navigate should not be called for a non-root path.
    await new Promise(r => setTimeout(r, 20));
    expect(navigate).not.toHaveBeenCalled();
  });
});
