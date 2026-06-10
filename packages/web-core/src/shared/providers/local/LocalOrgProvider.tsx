import { useCallback, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrganizationMemberWithProfile } from 'shared/types';
import type {
  CreateProjectRequest,
  UpdateProjectRequest,
} from 'shared/remote-types';
import type { InsertResult, MutationResult } from '@/shared/lib/electric/types';
import { localProjectsApi } from '@/shared/lib/api';
import { OrgContext, type OrgContextValue } from '@/shared/hooks/useOrgContext';
import {
  createLocalId,
  LOCAL_ORGANIZATION_ID,
  localProjectToRemoteProject,
} from './localKanbanAdapters';

export const localProjectKeys = {
  all: ['local-projects'] as const,
};

interface LocalOrgProviderProps {
  children: ReactNode;
}

export function LocalOrgProvider({ children }: LocalOrgProviderProps) {
  const queryClient = useQueryClient();
  const projectsQuery = useQuery({
    queryKey: localProjectKeys.all,
    queryFn: localProjectsApi.list,
  });

  const projects = useMemo(
    () => (projectsQuery.data ?? []).map(localProjectToRemoteProject),
    [projectsQuery.data]
  );

  const projectsById = useMemo(() => {
    const map = new Map<string, (typeof projects)[number]>();
    for (const project of projects) {
      map.set(project.id, project);
    }
    return map;
  }, [projects]);

  const getProject = useCallback(
    (projectId: string) => projectsById.get(projectId),
    [projectsById]
  );

  const invalidateProjects = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: localProjectKeys.all });
  }, [queryClient]);

  const insertProject = useCallback(
    (data: CreateProjectRequest): InsertResult<(typeof projects)[number]> => {
      const id = data.id ?? createLocalId();
      const now = new Date().toISOString();
      const optimisticProject = {
        id,
        organization_id: LOCAL_ORGANIZATION_ID,
        name: data.name,
        color: data.color,
        sort_order: projects.length,
        created_at: now,
        updated_at: now,
      };

      const persisted = localProjectsApi
        .create({ id, name: data.name })
        .then((project) =>
          localProjectToRemoteProject(project, projects.length)
        )
        .finally(invalidateProjects);

      return { data: optimisticProject, persisted };
    },
    [invalidateProjects, projects.length]
  );

  const updateProject = useCallback(
    (id: string, changes: Partial<UpdateProjectRequest>): MutationResult => ({
      persisted: localProjectsApi
        .update(id, { name: changes.name ?? undefined })
        .then(() => undefined)
        .finally(invalidateProjects),
    }),
    [invalidateProjects]
  );

  const removeProject = useCallback(
    (id: string): MutationResult => ({
      persisted: localProjectsApi
        .remove(id)
        .then(() => undefined)
        .finally(invalidateProjects),
    }),
    [invalidateProjects]
  );

  const value = useMemo<OrgContextValue>(
    () => ({
      organizationId: LOCAL_ORGANIZATION_ID,
      projects,
      isLoading: projectsQuery.isLoading,
      error: projectsQuery.error
        ? { message: projectsQuery.error.message }
        : null,
      retry: () => {
        void projectsQuery.refetch();
      },
      insertProject,
      updateProject,
      removeProject,
      getProject,
      projectsById,
      membersWithProfilesById: new Map<string, OrganizationMemberWithProfile>(),
    }),
    [
      projects,
      projectsQuery,
      insertProject,
      updateProject,
      removeProject,
      getProject,
      projectsById,
    ]
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}
