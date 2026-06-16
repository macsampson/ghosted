import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getUser, startGoogleSignIn } from '@/lib/auth';
import { useProfile } from '@/hooks/useEmails';
import { useStartCheckout, useOpenPortal } from '@/hooks/useBilling';
import { LandingNav } from '@/components/landing/LandingNav';
import { LandingFooter } from '@/components/landing/LandingFooter';
import { PricingCard } from '@/components/landing/PricingCard';
import { TIERS } from '@/lib/pricing';

/**
 * Public pricing page ("Get Pro"). Free vs Pro cards. CTA behaviour depends on
 * auth + plan state: signed-out → Google sign-in; free → Stripe checkout; pro →
 * billing portal.
 */
export function Pricing() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    getUser()
      .then(() => setSignedIn(true))
      .catch(() => setSignedIn(false));
  }, []);

  const { data: profile } = useProfile({ enabled: signedIn === true });
  const { mutate: startCheckout, isPending: checkoutPending } = useStartCheckout();
  const { mutate: openPortal, isPending: portalPending } = useOpenPortal();

  const isPro = profile?.plan === 'pro';
  const billingCanceled = searchParams.get('billing') === 'cancel';

  function handleSelect(tierId: 'free' | 'pro') {
    if (!signedIn) {
      startGoogleSignIn(navigate);
      return;
    }
    if (tierId === 'free') {
      navigate('/dashboard');
      return;
    }
    if (isPro) openPortal();
    else startCheckout();
  }

  function ctaFor(tierId: 'free' | 'pro', defaultCta: string): string {
    if (tierId === 'pro' && isPro) return 'Manage subscription';
    if (tierId === 'free' && signedIn) return 'Go to dashboard';
    return defaultCta;
  }

  function noteFor(tierId: 'free' | 'pro'): string | undefined {
    if (tierId === 'pro' && isPro) return 'Your current plan';
    if (tierId === 'free' && signedIn && !isPro) return 'Your current plan';
    return undefined;
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <LandingNav solid />
      {/* Dark gradient + soft radial glow, matching the landing hero. */}
      <main className="relative overflow-hidden bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 px-4 pb-24 pt-32 text-white sm:px-6">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl"
        />

        <div className="relative mx-auto max-w-5xl">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">Pricing</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Simple pricing for a faster job search
            </h1>
            <p className="mt-4 text-lg text-slate-300">
              Start free. Upgrade to Pro when you want AI to watch your inbox for you.
            </p>
          </div>

          {billingCanceled && (
            <p className="mx-auto mt-6 max-w-md rounded-md border border-slate-700 bg-slate-800/60 px-4 py-2 text-center text-sm text-slate-300">
              Checkout canceled — you can upgrade any time.
            </p>
          )}

          <div className="mt-14 grid gap-8 md:grid-cols-2">
            {TIERS.map((tier) => (
              <PricingCard
                key={tier.id}
                tier={tier}
                cta={ctaFor(tier.id, tier.cta)}
                onClick={() => handleSelect(tier.id)}
                disabled={tier.id === 'pro' && (checkoutPending || portalPending)}
                note={noteFor(tier.id)}
              />
            ))}
          </div>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
