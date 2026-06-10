import { createFileRoute } from '@tanstack/react-router';
import { LandingPage } from '@/features/onboarding/ui/LandingPage';
import { useEffect } from 'react';
import { useCloudFeaturesEnabled } from '@/shared/hooks/useAppRuntime';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';

function OnboardingLandingRouteComponent() {
  const cloudFeaturesEnabled = useCloudFeaturesEnabled();
  const appNavigation = useAppNavigation();

  useEffect(() => {
    if (!cloudFeaturesEnabled) {
      appNavigation.goToWorkspacesCreate({ replace: true });
    }
  }, [appNavigation, cloudFeaturesEnabled]);

  if (!cloudFeaturesEnabled) {
    return (
      <div className="h-screen bg-primary flex items-center justify-center">
        <p className="text-low">Loading...</p>
      </div>
    );
  }

  return <LandingPage />;
}

export const Route = createFileRoute('/onboarding')({
  component: OnboardingLandingRouteComponent,
});
