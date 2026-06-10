import { useNavigate } from 'react-router-dom';
import { startGoogleSignIn } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface CtaButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'subtle';
  className?: string;
}

/**
 * The single sign-in entry point for the landing page. Every "Get started" /
 * "Sign in" button on the page routes through here so the auth handoff lives in
 * one spot. `subtle` is for the nav bar over the dark hero.
 */
export function CtaButton({ children, variant = 'primary', className }: CtaButtonProps) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => startGoogleSignIn(navigate)}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors',
        variant === 'primary' &&
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        variant === 'subtle' &&
          'text-slate-200 hover:bg-white/10',
        className,
      )}
    >
      {children}
    </button>
  );
}
