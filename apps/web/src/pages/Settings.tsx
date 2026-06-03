import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Mail, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useProfile, useStartGmailAuth } from '@/hooks/useEmails';

export function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();
  const { data: profile, isLoading } = useProfile();
  const { mutate: startGmailAuth, isPending } = useStartGmailAuth();

  // Handle redirect-back from Google OAuth (prod flow)
  useEffect(() => {
    if (searchParams.get('connected') === 'true') {
      qc.invalidateQueries({ queryKey: ['profile'] });
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, qc, setSearchParams]);

  const oauthError = searchParams.get('error');

  return (
    <div className="p-8">
      <h1 className="mb-6 text-2xl font-bold">Settings</h1>

      <div className="max-w-lg">
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
              <Mail className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">Gmail integration</p>
              <p className="text-sm text-muted-foreground">
                Monitor your inbox for application updates
              </p>
            </div>
          </div>

          {oauthError && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                {oauthError === 'no_refresh_token'
                  ? 'Gmail did not return a refresh token. Try revoking access at myaccount.google.com/permissions and reconnecting.'
                  : `Connection failed: ${oauthError}`}
              </span>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : profile?.gmailConnected ? (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle className="h-4 w-4" />
              Gmail connected — inbox will be scanned every 15 minutes
            </div>
          ) : (
            <div>
              <p className="mb-4 text-sm text-muted-foreground">
                Grant read-only access to your Gmail so the app can detect rejections,
                interview requests, and offers automatically.
              </p>
              <button
                onClick={() => startGmailAuth()}
                disabled={isPending}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                {isPending ? 'Connecting…' : 'Connect Gmail'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
