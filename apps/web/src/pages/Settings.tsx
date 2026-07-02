import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Mail, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useProfile, useStartGmailAuth } from '@/hooks/useEmails';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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
    <div className="animate-fade-in p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage integrations and account preferences.</p>
      </div>

      <div className="max-w-lg">
        <Card className="p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold">Gmail integration</p>
              <p className="text-sm text-muted-foreground">
                Monitor your inbox for application updates
              </p>
            </div>
          </div>

          {oauthError && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
            <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-300">
                <CheckCircle className="h-4 w-4" />
                Gmail connected
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => startGmailAuth()}
                disabled={isPending}
                className="gap-2"
              >
                {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                Reconnect
              </Button>
            </div>
          ) : (
            <div>
              <p className="mb-4 text-sm text-muted-foreground">
                Grant read-only access to your Gmail so the app can detect rejections,
                interview requests, and offers automatically.
              </p>
              <Button onClick={() => startGmailAuth()} disabled={isPending} className="gap-2">
                {isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                {isPending ? 'Connecting…' : 'Connect Gmail'}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
