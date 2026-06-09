import { getCurrentUser, fetchAuthSession, signOut } from 'aws-amplify/auth';

// In dev with VITE_AUTH_BYPASS=true the app skips Cognito entirely.
// The Express dev server injects a matching fake user on every request.
const BYPASS = import.meta.env.VITE_AUTH_BYPASS === 'true';

const DEV_USER = { sub: 'dev-user-local-123', email: 'dev@ghosted.local', username: 'devuser' };

// In bypass mode there's no real Cognito session, so sign-out is faked with a
// per-tab sessionStorage flag. This lets the sign-out → sign-in loop actually
// work in dev. Resets on a fresh tab so `npm run dev` lands you signed in.
const BYPASS_SIGNED_OUT = 'bypass-signed-out';

export async function getUser() {
  if (BYPASS) {
    if (sessionStorage.getItem(BYPASS_SIGNED_OUT)) throw new Error('Signed out');
    return DEV_USER;
  }
  return getCurrentUser();
}

export async function signInDev() {
  sessionStorage.removeItem(BYPASS_SIGNED_OUT);
}

export async function getIdToken(): Promise<string> {
  if (BYPASS) return 'dev-token';
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new Error('Not authenticated');
  return token;
}

export async function logout() {
  if (BYPASS) {
    sessionStorage.setItem(BYPASS_SIGNED_OUT, '1');
    return;
  }
  await signOut();
}
