import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAuthRuntime } from '@/shared/lib/auth/runtime';
import { useEffect } from 'react';
import { useAuth } from '@/shared/hooks/auth/useAuth';
import { useCloudFeaturesEnabled } from '@/shared/hooks/useAppRuntime';

export function useCurrentUser() {
  const { isSignedIn } = useAuth();
  const cloudFeaturesEnabled = useCloudFeaturesEnabled();
  const query = useQuery({
    queryKey: ['auth', 'user'],
    queryFn: () => getAuthRuntime().getCurrentUser(),
    enabled: cloudFeaturesEnabled && isSignedIn,
    retry: 2,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const queryClient = useQueryClient();
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ['auth', 'user'] });
  }, [cloudFeaturesEnabled, queryClient, isSignedIn]);

  return query;
}
