import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Amplify auth is mocked; the production path just delegates to these.
const getCurrentUser = vi.fn();
const fetchAuthSession = vi.fn();
const signOut = vi.fn();
const signInWithRedirect = vi.fn();
vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: (...a: unknown[]) => getCurrentUser(...a),
  fetchAuthSession: (...a: unknown[]) => fetchAuthSession(...a),
  signOut: (...a: unknown[]) => signOut(...a),
  signInWithRedirect: (...a: unknown[]) => signInWithRedirect(...a),
}));

// BYPASS is read at module-load time, so each mode needs a fresh import with the
// env var stubbed first.
async function loadAuth(bypass: boolean) {
  vi.resetModules();
  vi.stubEnv('VITE_AUTH_BYPASS', bypass ? 'true' : 'false');
  return import('@/lib/auth');
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('auth in bypass mode', () => {
  it('getUser returns the dev user when not signed out', async () => {
    const auth = await loadAuth(true);
    await expect(auth.getUser()).resolves.toMatchObject({ sub: 'dev-user-local-123' });
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it('getUser throws after logout, then resolves again after signInDev', async () => {
    const auth = await loadAuth(true);
    await auth.logout();
    await expect(auth.getUser()).rejects.toThrow('Signed out');

    await auth.signInDev();
    await expect(auth.getUser()).resolves.toMatchObject({ email: 'dev@ghosted.local' });
  });

  it('getIdToken returns the dev token without hitting Amplify', async () => {
    const auth = await loadAuth(true);
    await expect(auth.getIdToken()).resolves.toBe('dev-token');
    expect(fetchAuthSession).not.toHaveBeenCalled();
  });

  it('logout does not call Amplify signOut', async () => {
    const auth = await loadAuth(true);
    await auth.logout();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('startGoogleSignIn signs in the dev user and navigates to the dashboard', async () => {
    const auth = await loadAuth(true);
    await auth.logout();
    const navigate = vi.fn();
    await auth.startGoogleSignIn(navigate);

    expect(signInWithRedirect).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/dashboard');
    await expect(auth.getUser()).resolves.toMatchObject({ sub: 'dev-user-local-123' });
  });
});

describe('auth in production (Cognito) mode', () => {
  it('getUser delegates to getCurrentUser', async () => {
    getCurrentUser.mockResolvedValue({ userId: 'abc' });
    const auth = await loadAuth(false);
    await expect(auth.getUser()).resolves.toEqual({ userId: 'abc' });
  });

  it('getIdToken returns the id token from the session', async () => {
    fetchAuthSession.mockResolvedValue({ tokens: { idToken: { toString: () => 'jwt-123' } } });
    const auth = await loadAuth(false);
    await expect(auth.getIdToken()).resolves.toBe('jwt-123');
  });

  it('getIdToken throws when there is no token', async () => {
    fetchAuthSession.mockResolvedValue({ tokens: undefined });
    const auth = await loadAuth(false);
    await expect(auth.getIdToken()).rejects.toThrow('Not authenticated');
  });

  it('logout delegates to Amplify signOut', async () => {
    signOut.mockResolvedValue(undefined);
    const auth = await loadAuth(false);
    await auth.logout();
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('startGoogleSignIn redirects to the Google hosted UI without navigating', async () => {
    signInWithRedirect.mockResolvedValue(undefined);
    const auth = await loadAuth(false);
    const navigate = vi.fn();
    await auth.startGoogleSignIn(navigate);

    expect(signInWithRedirect).toHaveBeenCalledWith({ provider: 'Google' });
    expect(navigate).not.toHaveBeenCalled();
  });
});
