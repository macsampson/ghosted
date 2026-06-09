import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const signInWithRedirect = vi.fn();
const getUser = vi.fn();
const signInDev = vi.fn();
vi.mock('aws-amplify/auth', () => ({ signInWithRedirect: (...a: unknown[]) => signInWithRedirect(...a) }));
vi.mock('@/lib/auth', () => ({
  getUser: () => getUser(),
  signInDev: () => signInDev(),
}));

async function renderLogin() {
  const { Login } = await import('@/pages/Login');
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<div>dashboard page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});
afterEach(() => vi.unstubAllEnvs());

describe('Login (Cognito mode)', () => {
  it('redirects to dashboard if already signed in', async () => {
    vi.stubEnv('VITE_AUTH_BYPASS', 'false');
    getUser.mockResolvedValue({ sub: 'u1' });
    await renderLogin();
    expect(await screen.findByText('dashboard page')).toBeInTheDocument();
  });

  it('stays on the login page when not signed in and triggers Google OAuth', async () => {
    vi.stubEnv('VITE_AUTH_BYPASS', 'false');
    getUser.mockRejectedValue(new Error('no session'));
    await renderLogin();

    const btn = await screen.findByRole('button', { name: /continue with google/i });
    await userEvent.click(btn);
    expect(signInWithRedirect).toHaveBeenCalledWith({ provider: 'Google' });
    expect(signInDev).not.toHaveBeenCalled();
  });
});

describe('Login (bypass mode)', () => {
  it('uses the dev sign-in and navigates to dashboard', async () => {
    vi.stubEnv('VITE_AUTH_BYPASS', 'true');
    getUser.mockRejectedValue(new Error('no session'));
    signInDev.mockResolvedValue(undefined);
    await renderLogin();

    await userEvent.click(await screen.findByRole('button', { name: /continue with google/i }));
    expect(signInDev).toHaveBeenCalledOnce();
    expect(signInWithRedirect).not.toHaveBeenCalled();
    expect(await screen.findByText('dashboard page')).toBeInTheDocument();
  });
});
