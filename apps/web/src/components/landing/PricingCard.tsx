import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlanTier } from '@/lib/pricing';

interface PricingCardProps {
  tier: PlanTier;
  cta: string;
  onClick: () => void;
  disabled?: boolean;
  /** Shown under the CTA, e.g. "Your current plan". */
  note?: string;
}

/** A single Free/Pro pricing card. The Pro card is visually highlighted. */
export function PricingCard({ tier, cta, onClick, disabled, note }: PricingCardProps) {
  return (
    <div
      className={cn(
        'relative flex flex-col rounded-2xl border bg-card p-8 text-card-foreground shadow-sm',
        tier.highlighted ? 'border-primary ring-1 ring-primary' : 'border-border',
      )}
    >
      {tier.highlighted && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
          Most popular
        </span>
      )}

      <h3 className="text-lg font-semibold">{tier.name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{tier.tagline}</p>

      <div className="mt-6 flex items-baseline gap-1">
        <span className="text-4xl font-bold tracking-tight">{tier.price}</span>
        {tier.priceSuffix && (
          <span className="text-sm text-muted-foreground">{tier.priceSuffix}</span>
        )}
      </div>

      <ul className="mt-8 flex-1 space-y-3">
        {tier.features.map((feature) => (
          <li key={feature} className="flex items-start gap-3 text-sm">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <button
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'mt-8 inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors disabled:opacity-60',
          tier.highlighted
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'border border-border hover:bg-accent',
        )}
      >
        {cta}
      </button>
      {note && <p className="mt-3 text-center text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
