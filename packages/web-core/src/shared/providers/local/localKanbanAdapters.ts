import type { Project as LocalProject, Task, TaskStatus } from 'shared/types';
import type {
  Issue,
  Project,
  ProjectStatus,
  Tag,
  IssueAssignee,
  IssueFollower,
  IssueRelationship,
  IssueTag,
  PullRequest,
  PullRequestIssue,
  Workspace,
} from 'shared/remote-types';

export const LOCAL_ORGANIZATION_ID = '00000000-0000-0000-0000-000000000000';

const LOCAL_PROJECT_COLORS = [
  '210 90% 56%',
  '155 64% 42%',
  '35 92% 50%',
  '345 78% 58%',
  '265 78% 64%',
  '190 78% 42%',
];

export const LOCAL_PROJECT_STATUSES: ProjectStatus[] = [
  {
    id: 'todo',
    project_id: '',
    name: 'Todo',
    color: '220 14% 56%',
    sort_order: 0,
    hidden: false,
    created_at: '',
  },
  {
    id: 'inprogress',
    project_id: '',
    name: 'In Progress',
    color: '210 90% 56%',
    sort_order: 1,
    hidden: false,
    created_at: '',
  },
  {
    id: 'inreview',
    project_id: '',
    name: 'In Review',
    color: '35 92% 50%',
    sort_order: 2,
    hidden: false,
    created_at: '',
  },
  {
    id: 'done',
    project_id: '',
    name: 'Done',
    color: '155 64% 42%',
    sort_order: 3,
    hidden: false,
    created_at: '',
  },
  {
    id: 'cancelled',
    project_id: '',
    name: 'Cancelled',
    color: '0 70% 55%',
    sort_order: 4,
    hidden: true,
    created_at: '',
  },
];

export const EMPTY_LOCAL_TAGS: Tag[] = [];
export const EMPTY_LOCAL_ISSUE_ASSIGNEES: IssueAssignee[] = [];
export const EMPTY_LOCAL_ISSUE_FOLLOWERS: IssueFollower[] = [];
export const EMPTY_LOCAL_ISSUE_TAGS: IssueTag[] = [];
export const EMPTY_LOCAL_ISSUE_RELATIONSHIPS: IssueRelationship[] = [];
export const EMPTY_LOCAL_PULL_REQUESTS: PullRequest[] = [];
export const EMPTY_LOCAL_PULL_REQUEST_ISSUES: PullRequestIssue[] = [];
export const EMPTY_LOCAL_WORKSPACES: Workspace[] = [];

export function createLocalId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isTaskStatus(
  value: string | null | undefined
): value is TaskStatus {
  return (
    value === 'todo' ||
    value === 'inprogress' ||
    value === 'inreview' ||
    value === 'done' ||
    value === 'cancelled'
  );
}

export function localProjectToRemoteProject(
  project: LocalProject,
  index: number
): Project {
  return {
    id: project.id,
    organization_id: LOCAL_ORGANIZATION_ID,
    name: project.name,
    color: LOCAL_PROJECT_COLORS[index % LOCAL_PROJECT_COLORS.length],
    sort_order: index,
    created_at: String(project.created_at),
    updated_at: String(project.updated_at),
  };
}

export function localStatusesForProject(projectId: string): ProjectStatus[] {
  const now = new Date().toISOString();

  return LOCAL_PROJECT_STATUSES.map((status) => ({
    ...status,
    project_id: projectId,
    created_at: status.created_at || now,
  }));
}

export function localTaskToIssue(task: Task, index: number): Issue {
  const issueNumber = index + 1;

  return {
    id: task.id,
    project_id: task.project_id,
    issue_number: issueNumber,
    simple_id: `T-${task.id.slice(0, 6).toUpperCase()}`,
    status_id: task.status,
    title: task.title,
    description: task.description,
    priority: null,
    start_date: null,
    target_date: null,
    completed_at: task.status === 'done' ? task.updated_at : null,
    sort_order: task.sort_order,
    parent_issue_id: null,
    parent_issue_sort_order: null,
    extension_metadata: null,
    creator_user_id: null,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}

export function localTaskToWorkspace(task: Task): Workspace | null {
  if (!task.parent_workspace_id) {
    return null;
  }

  return {
    id: task.parent_workspace_id,
    project_id: task.project_id,
    owner_user_id: LOCAL_ORGANIZATION_ID,
    issue_id: task.id,
    local_workspace_id: task.parent_workspace_id,
    name: task.title,
    archived: task.status === 'cancelled',
    files_changed: 0,
    lines_added: 0,
    lines_removed: 0,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}
