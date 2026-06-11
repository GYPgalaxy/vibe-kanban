import { useMutation, useQueryClient } from '@tanstack/react-query';
import { localTasksApi, workspacesApi } from '@/shared/lib/api';
import type { CreateAndStartWorkspaceRequest } from 'shared/types';
import { workspaceSummaryKeys } from '@/shared/hooks/workspaceSummaryKeys';
import { useCloudFeaturesEnabled } from '@/shared/hooks/useAppRuntime';

interface CreateWorkspaceParams {
  data: CreateAndStartWorkspaceRequest;
  linkToIssue?: {
    remoteProjectId: string;
    issueId: string;
  };
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  const cloudFeaturesEnabled = useCloudFeaturesEnabled();

  const createWorkspace = useMutation({
    mutationFn: async ({ data, linkToIssue }: CreateWorkspaceParams) => {
      const { workspace } = await workspacesApi.createAndStart(data);

      if (linkToIssue && workspace) {
        try {
          if (cloudFeaturesEnabled) {
            await workspacesApi.linkToIssue(
              workspace.id,
              linkToIssue.remoteProjectId,
              linkToIssue.issueId
            );
          } else {
            await localTasksApi.update(linkToIssue.issueId, {
              parent_workspace_id: workspace.id,
            });
          }
        } catch (linkError) {
          console.error('Failed to link workspace to issue:', linkError);
        }
      }

      return { workspace };
    },
    onSuccess: () => {
      // Invalidate workspace summaries so they refresh with the new workspace included
      queryClient.invalidateQueries({ queryKey: workspaceSummaryKeys.all });
      queryClient.invalidateQueries({ queryKey: ['local-project-tasks'] });
      // Ensure create-mode defaults refetch the latest session/model selection.
      queryClient.invalidateQueries({ queryKey: ['workspaceCreateDefaults'] });
    },
    onError: (err) => {
      console.error('Failed to create workspace:', err);
    },
  });

  return { createWorkspace };
}
