import { createFileRoute } from '@tanstack/react-router';
import { Provider as NiceModalProvider } from '@ebay/nice-modal-react';
import { OnboardingSignInPage } from '@/features/onboarding/ui/OnboardingSignInPage';
import { useEffect } from 'react';
import { useCloudFeaturesEnabled } from '@/shared/hooks/useAppRuntime';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';

function OnboardingSignInRouteComponent() {
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

  return (
    <NiceModalProvider>
      <OnboardingSignInPage />
    </NiceModalProvider>
  );
}

export const Route = createFileRoute('/onboarding_/sign-in')({
  component: OnboardingSignInRouteComponent,
});
