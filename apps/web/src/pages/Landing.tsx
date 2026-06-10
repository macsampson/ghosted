import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUser } from '@/lib/auth';
import { LandingNav } from '@/components/landing/LandingNav';
import { Hero } from '@/components/landing/Hero';
import { ProblemSection } from '@/components/landing/ProblemSection';
import { FeatureSection } from '@/components/landing/FeatureSection';
import { Spotlight } from '@/components/landing/Spotlight';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { PrivacySection } from '@/components/landing/PrivacySection';
import { FinalCta } from '@/components/landing/FinalCta';
import { LandingFooter } from '@/components/landing/LandingFooter';

/**
 * Public marketing landing page served at `/`. Authenticated visitors are
 * redirected straight into the app (same pattern as the Login page).
 */
export function Landing() {
  const navigate = useNavigate();

  useEffect(() => {
    getUser()
      .then(() => navigate('/dashboard', { replace: true }))
      .catch(() => {
        // Not signed in — show the marketing page.
      });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <LandingNav />
      <main>
        <Hero />
        <ProblemSection />
        <FeatureSection />
        <Spotlight />
        <HowItWorks />
        <PrivacySection />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}
