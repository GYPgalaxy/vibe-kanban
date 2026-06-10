import { useQuery } from '@tanstack/react-query';
import { organizationsApi } from '@/shared/lib/api';
import { useAuth } from '@/shared/hooks/auth/useAuth';
import type { ListOrganizationsResponse } from 'shared/types';
import { organizationKeys } from '@/shared/hooks/organizationKeys';
import { useCloudFeaturesEnabled } from '@/shared/hooks/useAppRuntime';

/**
 * Hook to fetch all organizations that the current user is a member of
 */
export function useUserOrganizations() {
  const { isSignedIn } = useAuth();
  const cloudFeaturesEnabled = useCloudFeaturesEnabled();

  return useQuery<ListOrganizationsResponse>({
    queryKey: organizationKeys.userList(),
    queryFn: () => organizationsApi.getUserOrganizations(),
    enabled: cloudFeaturesEnabled && isSignedIn,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
