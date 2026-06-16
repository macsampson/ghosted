/**
 * Pricing + free-tier limits for the marketing/pricing UI. The limit numbers
 * mirror `apps/api/src/lib/plan.ts` (the backend is the enforcement source of
 * truth) — keep the two in sync. The price is display-only; the real amount
 * lives on the Stripe Price referenced by STRIPE_PRICE_ID.
 */
export const LIMITS = {
  applications: 25,
  resumes: 1,
  classificationsPerMonth: 20,
} as const;

/** Monthly Pro price, for display. Change here to restyle the cards. */
export const PRO_PRICE = {
  amount: 5,
  currency: 'USD',
  symbol: '$',
  interval: 'month',
} as const;

export interface PlanTier {
  id: 'free' | 'pro';
  name: string;
  tagline: string;
  price: string;
  priceSuffix?: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
}

export const TIERS: PlanTier[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Track your search by hand.',
    price: `${PRO_PRICE.symbol}0`,
    features: [
      `Up to ${LIMITS.applications} tracked applications`,
      `${LIMITS.resumes} resume variant`,
      `${LIMITS.classificationsPerMonth} AI email scans per month`,
      'Pipeline board & analytics dashboard',
    ],
    cta: 'Get started',
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Let AI run your inbox.',
    price: `${PRO_PRICE.symbol}${PRO_PRICE.amount}`,
    priceSuffix: `/${PRO_PRICE.interval}`,
    features: [
      'Unlimited applications',
      'Unlimited resume variants',
      'Unlimited AI email monitoring',
      'Daily stale-application digest',
      'Everything in Free',
    ],
    cta: 'Get Pro',
    highlighted: true,
  },
];
