import { useCallback, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateTask } from 'shared/types';
import type {
  CreateIssueRequest,
  CreateIssueAssigneeRequest,
  CreateIssueFollowerRequest,
  CreateIssueRelationshipRequest,
  CreateIssueTagRequest,
  CreateProjectStatusRequest,
  CreatePullRequestIssueRequest,
  CreateTagRequest,
  Issue,
  IssueAssignee,
  IssueFollower,
  IssueRelationship,
  IssueTag,
  ProjectStatus,
  PullRequestIssue,
  Tag,
  UpdateIssueRequest,
  UpdateProjectStatusRequest,
  UpdateTagRequest,
} from 'shared/remote-types';
import type { InsertResult, MutationResult } from '@/shared/lib/electric/types';
import { localTasksApi } from '@/shared/lib/api';
import {
  ProjectContext,
  type ProjectContextValue,
} from '@/shared/hooks/useProjectContext';
import {
  createLocalId,
  EMPTY_LOCAL_ISSUE_ASSIGNEES,
  EMPTY_LOCAL_ISSUE_FOLLOWERS,
  EMPTY_LOCAL_ISSUE_RELATIONSHIPS,
  EMPTY_LOCAL_ISSUE_TAGS,
  EMPTY_LOCAL_PULL_REQUEST_ISSUES,
  EMPTY_LOCAL_PULL_REQUESTS,
  EMPTY_LOCAL_TAGS,
  EMPTY_LOCAL_WORKSPACES,
  isTaskStatus,
  localStatusesForProject,
  localTaskToIssue,
} from './localKanbanAdapters';

export const localTaskKeys = {
  byProject: (projectId: string) => ['local-project-tasks', projectId] as const,
};

interface LocalProjectProviderProps {
  projectId: string;
  children: ReactNode;
}

function noopMutation(): MutationResult {
  return { persisted: Promise.resolve() };
}

function noopInsert<TRow>(row: TRow): InsertResult<TRow> {
  return { data: row, persisted: Promise.resolve(row) };
}

function issueChangesToTaskChanges(
  changes: Partial<UpdateIssueRequest>
): Partial<UpdateTask> {
  const taskChanges: Partial<UpdateTask> = {};

  if (typeof changes.title === 'string') {
    taskChanges.title = changes.title;
  }

  if (changes.description !== undefined) {
    taskChanges.description = changes.description ?? null;
  }

  if (isTaskStatus(changes.status_id)) {
    taskChanges.status = changes.status_id;
  }

  if (typeof changes.sort_order === 'number') {
    taskChanges.sort_order = changes.sort_order;
  }

  return taskChanges;
}

export function LocalProjectProvider({
  projectId,
  children,
}: LocalProjectProviderProps) {
  const queryClient = useQueryClient();
  const tasksQuery = useQuery({
    queryKey: localTaskKeys.byProject(projectId),
    queryFn: () => localTasksApi.listByProject(projectId),
    enabled: Boolean(projectId),
  });

  const issues = useMemo(
    () => (tasksQuery.data ?? []).map(localTaskToIssue),
    [tasksQuery.data]
  );
  const statuses = useMemo(
    () => localStatusesForProject(projectId),
    [projectId]
  );

  const issuesById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of issues) {
      map.set(issue.id, issue);
    }
    return map;
  }, [issues]);

  const statusesById = useMemo(() => {
    const map = new Map<string, ProjectStatus>();
    for (const status of statuses) {
      map.set(status.id, status);
    }
    return map;
  }, [statuses]);

  const tagsById = useMemo(() => new Map<string, Tag>(), []);

  const invalidateTasks = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: localTaskKeys.byProject(projectId),
    });
  }, [projectId, queryClient]);

  const getIssue = useCallback(
    (issueId: string) => issuesById.get(issueId),
    [issuesById]
  );
  const getIssuesForStatus = useCallback(
    (statusId: string) =>
      issues.filter((issue) => issue.status_id === statusId),
    [issues]
  );
  const getStatus = useCallback(
    (statusId: string) => statusesById.get(statusId),
    [statusesById]
  );
  const getTag = useCallback(
    (tagId: string) => tagsById.get(tagId),
    [tagsById]
  );

  const insertIssue = useCallback(
    (data: CreateIssueRequest): InsertResult<Issue> => {
      const id = data.id ?? createLocalId();
      const now = new Date().toISOString();
      const status = isTaskStatus(data.status_id) ? data.status_id : 'todo';
      const optimisticIssue: Issue = {
        id,
        project_id: projectId,
        issue_number: issues.length + 1,
        simple_id: `T-${id.slice(0, 6).toUpperCase()}`,
        status_id: status,
        title: data.title,
        description: data.description,
        priority: null,
        start_date: null,
        target_date: null,
        completed_at: status === 'done' ? now : null,
        sort_order: data.sort_order,
        parent_issue_id: null,
        parent_issue_sort_order: null,
        extension_metadata: null,
        creator_user_id: null,
        created_at: now,
        updated_at: now,
      };

      const persisted = localTasksApi
        .create(projectId, {
          id,
          title: data.title,
          description: data.description,
          status,
          parent_workspace_id: null,
          sort_order: data.sort_order,
        })
        .then((task) => localTaskToIssue(task, issues.length))
        .finally(invalidateTasks);

      return { data: optimisticIssue, persisted };
    },
    [invalidateTasks, issues.length, projectId]
  );

  const updateIssue = useCallback(
    (id: string, changes: Partial<UpdateIssueRequest>): MutationResult => ({
      persisted: localTasksApi
        .update(id, issueChangesToTaskChanges(changes))
        .then(() => undefined)
        .finally(invalidateTasks),
    }),
    [invalidateTasks]
  );

  const removeIssue = useCallback(
    (id: string): MutationResult => ({
      persisted: localTasksApi
        .remove(id)
        .then(() => undefined)
        .finally(invalidateTasks),
    }),
    [invalidateTasks]
  );

  const bulkUpdateIssues = useCallback(
    (
      updates: { id: string; changes: Partial<UpdateIssueRequest> }[]
    ): MutationResult => ({
      persisted: localTasksApi
        .bulkUpdate(
          updates.map((update) => ({
            id: update.id,
            changes: issueChangesToTaskChanges(update.changes),
          }))
        )
        .then(() => undefined)
        .finally(invalidateTasks),
    }),
    [invalidateTasks]
  );

  const value = useMemo<ProjectContextValue>(
    () => ({
      projectId,
      issues,
      statuses,
      tags: EMPTY_LOCAL_TAGS,
      issueAssignees: EMPTY_LOCAL_ISSUE_ASSIGNEES,
      issueFollowers: EMPTY_LOCAL_ISSUE_FOLLOWERS,
      issueTags: EMPTY_LOCAL_ISSUE_TAGS,
      issueRelationships: EMPTY_LOCAL_ISSUE_RELATIONSHIPS,
      pullRequests: EMPTY_LOCAL_PULL_REQUESTS,
      pullRequestIssues: EMPTY_LOCAL_PULL_REQUEST_ISSUES,
      workspaces: EMPTY_LOCAL_WORKSPACES,
      isLoading: tasksQuery.isLoading,
      error: tasksQuery.error ? { message: tasksQuery.error.message } : null,
      retry: () => {
        void tasksQuery.refetch();
      },
      insertIssue,
      updateIssue,
      removeIssue,
      bulkUpdateIssues,
      insertStatus: (data: CreateProjectStatusRequest) =>
        noopInsert({
          id: data.id ?? createLocalId(),
          project_id: projectId,
          name: data.name,
          color: data.color,
          sort_order: data.sort_order,
          hidden: data.hidden,
          created_at: new Date().toISOString(),
        }),
      updateStatus: (
        _id: string,
        _changes: Partial<UpdateProjectStatusRequest>
      ) => noopMutation(),
      removeStatus: () => noopMutation(),
      insertTag: (data: CreateTagRequest) =>
        noopInsert({
          id: data.id ?? createLocalId(),
          project_id: projectId,
          name: data.name,
          color: data.color,
        }),
      updateTag: (_id: string, _changes: Partial<UpdateTagRequest>) =>
        noopMutation(),
      removeTag: () => noopMutation(),
      insertIssueAssignee: (data: CreateIssueAssigneeRequest) =>
        noopInsert<IssueAssignee>({
          id: data.id ?? createLocalId(),
          issue_id: data.issue_id,
          user_id: data.user_id,
          assigned_at: new Date().toISOString(),
        }),
      removeIssueAssignee: () => noopMutation(),
      insertIssueFollower: (data: CreateIssueFollowerRequest) =>
        noopInsert<IssueFollower>({
          id: data.id ?? createLocalId(),
          issue_id: data.issue_id,
          user_id: data.user_id,
        }),
      removeIssueFollower: () => noopMutation(),
      insertIssueTag: (data: CreateIssueTagRequest) =>
        noopInsert<IssueTag>({
          id: data.id ?? createLocalId(),
          issue_id: data.issue_id,
          tag_id: data.tag_id,
        }),
      removeIssueTag: () => noopMutation(),
      insertIssueRelationship: (data: CreateIssueRelationshipRequest) =>
        noopInsert<IssueRelationship>({
          id: data.id ?? createLocalId(),
          issue_id: data.issue_id,
          related_issue_id: data.related_issue_id,
          relationship_type: data.relationship_type,
          created_at: new Date().toISOString(),
        }),
      removeIssueRelationship: () => noopMutation(),
      insertPullRequestIssue: (data: CreatePullRequestIssueRequest) =>
        noopInsert<PullRequestIssue>({
          id: data.id ?? createLocalId(),
          pull_request_id: createLocalId(),
          issue_id: data.issue_id,
        }),
      removePullRequestIssue: () => noopMutation(),
      getIssue,
      getIssuesForStatus,
      getAssigneesForIssue: () => EMPTY_LOCAL_ISSUE_ASSIGNEES,
      getFollowersForIssue: () => EMPTY_LOCAL_ISSUE_FOLLOWERS,
      getTagsForIssue: () => EMPTY_LOCAL_ISSUE_TAGS,
      getTagObjectsForIssue: () => EMPTY_LOCAL_TAGS,
      getRelationshipsForIssue: () => EMPTY_LOCAL_ISSUE_RELATIONSHIPS,
      getStatus,
      getTag,
      getPullRequestsForIssue: () => EMPTY_LOCAL_PULL_REQUESTS,
      getWorkspacesForIssue: () => EMPTY_LOCAL_WORKSPACES,
      issuesById,
      statusesById,
      tagsById,
    }),
    [
      projectId,
      issues,
      statuses,
      tasksQuery,
      insertIssue,
      updateIssue,
      removeIssue,
      bulkUpdateIssues,
      getIssue,
      getIssuesForStatus,
      getStatus,
      getTag,
      issuesById,
      statusesById,
      tagsById,
    ]
  );

  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}
