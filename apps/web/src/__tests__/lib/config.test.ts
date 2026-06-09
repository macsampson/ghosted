import { describe, it, expect, vi } from 'vitest';

// amplify.ts calls Amplify.configure() at import time; capture the call.
const configure = vi.fn();
vi.mock('aws-amplify', () => ({ Amplify: { configure: (...a: unknown[]) => configure(...a) } }));

describe('amplify config', () => {
  it('configures Cognito on import', async () => {
    await import('@/lib/amplify');
    expect(configure).toHaveBeenCalledOnce();
    const cfg = configure.mock.calls[0][0] as { Auth: { Cognito: Record<string, unknown> } };
    expect(cfg.Auth.Cognito).toBeDefined();
    expect(cfg.Auth.Cognito.loginWith).toBeDefined();
  });
});

describe('queryClient', () => {
  it('sets sane query defaults', async () => {
    const { queryClient } = await import('@/lib/queryClient');
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(60_000);
    expect(defaults.queries?.retry).toBe(1);
  });
});
