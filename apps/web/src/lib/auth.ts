import { getCurrentUser, fetchAuthSession, signOut } from 'aws-amplify/auth';

// In dev with VITE_AUTH_BYPASS=true the app skips Cognito entirely.
// The Express dev server injects a matching fake user on every request.
const BYPASS = import.meta.env.VITE_AUTH_BYPASS === 'true';

const DEV_USER = { sub: 'dev-user-local-123', email: 'dev@ghosted.local', username: 'devuser' };

export async function getUser() {
  if (BYPASS) return DEV_USER;
  return getCurrentUser();
}

export async function getIdToken(): Promise<string> {
  if (BYPASS) return 'dev-token';
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new Error('Not authenticated');
  return token;
}

export async function logout() {
  if (BYPASS) return;
  await signOut();
}
