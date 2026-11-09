import API, { type AnyData, type Params } from "./client";
import type { SprintList } from "../types/generated/tasks";

export interface TaskWorklog {
    id: number;
    task_id: number;
    author_id: number;
    logged_by_id: number;
    author: { id: number; username: string; full_name: string; avatar: string | null };
    logged_by: { id: number; username: string; full_name: string; avatar: string | null };
    day_worked: string;
    start_time: string | null;
    minutes: number;
    comment: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: null;
    canEdit: boolean;
    canDelete: boolean;
}

export interface TaskWorklogListResponse {
    worklogs: TaskWorklog[]; time_spent_minutes: number;
    original_estimate_minutes: number | null; remaining_estimate_minutes: number | null;
}
export const getTaskWorklogs = (id: number | string) =>
    API.get<TaskWorklogListResponse>(`/tasks/${id}/worklogs`);

export interface RemainingInput { remaining_mode?: 'auto' | 'set' | 'leave'; remaining_estimate?: string }
export interface LogWorkInput extends RemainingInput {
    day_worked: string;
    time_spent: string;
    start_time?: string | null;
    comment?: string | null;
    author_id?: number;
}
export interface WorklogTicketSummary { id: number; time_spent_minutes: number; logged_minutes: number; estimated_minutes: number | null;
    original_estimate_minutes: number | null; remaining_estimate_minutes: number | null }
export const setTaskEstimates = (id: number | string, input: { original_estimate?: string; remaining_estimate?: string }) =>
    API.patch<{ ticket: WorklogTicketSummary }>(`/tasks/${id}/estimates`, input);
export interface LogWorkResponse {
    worklog: TaskWorklog;
    ticket: WorklogTicketSummary;
    warnings: string[];
}
export const logTaskWork = (id: number | string, input: LogWorkInput) =>
    API.post<LogWorkResponse>(`/tasks/${id}/worklogs`, input);

export const editTaskWorklog = (id: number | string, worklogId: number, input: Partial<LogWorkInput>) =>
    API.patch<LogWorkResponse>(`/tasks/${id}/worklogs/${worklogId}`, input);

export const deleteTaskWorklog = (id: number | string, worklogId: number, input: RemainingInput = {}) =>
    API.delete<{ ticket: WorklogTicketSummary }>(`/tasks/${id}/worklogs/${worklogId}`, { data: input });

// Tasks
export const getTasks = (date?: string, filters?: Params, signal?: AbortSignal) => {
    const params: Params = { ...filters };
    if (date !== undefined) {
        params.date = date;
    }
    return API.get("/tasks", { params, signal });
};
export const addTask = (data: AnyData) => API.post("/tasks", data);
export const getProjectTypes = () => API.get<import("../types/generated/tasks").ProjectTypeOptions>("/projects/types");
export const getMyProjects = () => API.get("/projects/mine");
export const updateTaskStatus = (id: number | string, status: string) =>
    API.patch(`/tasks/${id}/status`, { status });
export const updateTask = (id: number | string, data: AnyData) => API.put(`/tasks/${id}`, data);
export const deleteTask = (id: number | string) => API.delete(`/tasks/${id}`);
export const transferTask = (id: number | string, teamId: number | string) =>
    API.post(`/tasks/${id}/transfer`, { team_id: teamId });
export interface ProjectMovePreview {
    target_project_id: number;
    key_format: string;
    workflow_state: { id: number; key: string; name: string; category: string };
    leaves_sprint: boolean;
}
export const previewTaskProjectMove = (id: number | string, projectId: number) =>
    API.post<ProjectMovePreview>(`/tasks/${id}/move-project/preview`, { project_id: projectId });
export const moveTaskProject = (id: number | string, projectId: number) =>
    API.post(`/tasks/${id}/move-project`, { project_id: projectId });
export const carryForwardTasks = () => API.post("/tasks/carry-forward");
export const getAssignableUsers = () => API.get("/tasks/assignable-users");
export const getTaskLabels = () => API.get("/tasks/labels");
export const getTaskLabelsManage = () => API.get("/tasks/labels/manage");
export const createTaskLabel = (data: AnyData) => API.post("/tasks/labels", data);
export const updateTaskLabel = (id: number | string, data: AnyData) =>
    API.put(`/tasks/labels/${id}`, data);
export const deleteTaskLabel = (id: number | string) => API.delete(`/tasks/labels/${id}`);
// â”€â”€ Stage 3: Projects, Git integration (GitHub OAuth), task git refs â”€â”€â”€â”€â”€
// Projects = Jira-style folders with a unique KEY (e.g. WEB). Tasks inside
// a project automatically get a per-project task_number, surfaced as
// "WEB-123" (issue_key) by the server's enrich step.
// Projects list â€” call without options for the legacy plain-array response,
// or pass `{ limit, offset }` to opt-in to the paginated `{ projects, pagination }`
// shape (page sizes are capped server-side).
export const getProjects = (
    includeArchived = false,
    opts: { limit?: number; offset?: number } | null = null
) => {
    const params: Params = {};
    if (includeArchived) params.include_archived = 1;
    if (opts && typeof opts === "object") {
        params.paginate = 1;
        if (opts.limit != null) params.limit = opts.limit;
        if (opts.offset != null) params.offset = opts.offset;
    }
    return API.get("/projects", { params });
};
export const getProject = (id: number | string) => API.get(`/projects/${id}`);
export interface ProjectKeyRenameResult {
    project_id: number;
    old_key: string;
    new_key: string;
    affected_tickets: number;
}
export const previewProjectKeyRename = (id: number | string, key: string) =>
    API.post<ProjectKeyRenameResult>(`/projects/${id}/key/preview`, { key });
export const renameProjectKey = (id: number | string, key: string) =>
    API.post<ProjectKeyRenameResult>(`/projects/${id}/key`, { key });
export const createProject = (data: AnyData) => API.post("/projects", data);
export const updateProject = (id: number | string, data: AnyData) =>
    API.put(`/projects/${id}`, data);
export const archiveProject = (id: number | string, isArchived: boolean) =>
    API.patch(`/projects/${id}/archive`, { is_archived: isArchived });
export const deleteProject = (id: number | string) => API.delete(`/projects/${id}`);
export const getProjectTasks = (id: number | string, params?: Params) =>
    API.get(`/projects/${id}/tasks`, { params });
export const getProjectWorkflow = (id: number | string) =>
    API.get(`/projects/${id}/workflow-states`);
export const createProjectWorkflowState = (id: number | string, data: AnyData) =>
    API.post(`/projects/${id}/workflow-states`, data);
export const updateProjectWorkflowState = (id: number | string, stateId: number | string, data: AnyData) =>
    API.put(`/projects/${id}/workflow-states/${stateId}`, data);
export const deleteProjectWorkflowState = (id: number | string, stateId: number | string) =>
    API.delete(`/projects/${id}/workflow-states/${stateId}`);
export const reorderProjectWorkflowStates = (id: number | string, order: Array<number | string>) =>
    API.put(`/projects/${id}/workflow-states/reorder`, { order });
export const updateProjectWorkflowTransitions = (id: number | string, transitions: AnyData[]) =>
    API.put(`/projects/${id}/workflow-transitions`, { transitions });
export const getProjectMembers = (id: number | string) => API.get(`/projects/${id}/members`);
export const grantProjectMember = (id: number | string, data: AnyData) =>
    API.post(`/projects/${id}/members`, data);
export const updateProjectMember = (id: number | string, memberId: number | string, role: string) =>
    API.put(`/projects/${id}/members/${memberId}`, { role });
export const removeProjectMember = (id: number | string, memberId: number | string) =>
    API.delete(`/projects/${id}/members/${memberId}`);

// GitHub integration â€” OAuth flow + repo selection.
export const startGithubOAuth = () => API.post("/integrations/github/oauth/start");
export const getGithubStatus = () => API.get("/integrations/github/status");
export const listGithubRepos = () => API.get("/integrations/github/repos");
export const connectGithubRepos = (repos: unknown) =>
    API.post("/integrations/github/repos/connect", { repos });
export const disconnectGithubRepo = (fullName: string) =>
    API.delete(`/integrations/github/repos/${encodeURIComponent(fullName)}`);
export const disconnectGithub = () => API.post("/integrations/github/disconnect");
export const listIntegrations = () => API.get("/integrations");

// Git refs (branches, PRs, commits) linked to a task.
export const getTaskGitRefs = (taskId: number | string) => API.get(`/tasks/${taskId}/git`);
export const linkTaskGitRef = (taskId: number | string, data: AnyData) =>
    API.post(`/tasks/${taskId}/git`, data);
export const unlinkTaskGitRef = (taskId: number | string, refId: number | string) =>
    API.delete(`/tasks/${taskId}/git/${refId}`);

export const getTaskComments = (taskId: number | string) => API.get(`/tasks/${taskId}/comments`);
// Add a comment with optional file attachment. When a file is present we send
// multipart/form-data; otherwise a plain JSON body keeps backward compat.
export const addTaskComment = (taskId: number | string, content?: string, file?: File) => {
    if (file) {
        const fd = new FormData();
        if (content) fd.append("content", content);
        fd.append("file", file);
        return API.post(`/tasks/${taskId}/comments`, fd, {
            headers: { "Content-Type": "multipart/form-data" },
        });
    }
    return API.post(`/tasks/${taskId}/comments`, { content });
};
export const updateTaskComment = (
    taskId: number | string,
    commentId: number | string,
    content: string
) => API.put(`/tasks/${taskId}/comments/${commentId}`, { content });
export const deleteTaskComment = (taskId: number | string, commentId: number | string) =>
    API.delete(`/tasks/${taskId}/comments/${commentId}`);

// Backlog
export const getBacklog = (filters?: Params) => API.get("/tasks/backlog", { params: filters });
/** Unsprinted tickets with a planned day — the Scheduled tab. */
export const getScheduled = (filters?: Params) => API.get("/tasks/scheduled", { params: filters });
export const addBacklogTask = (data: AnyData) => API.post("/tasks/backlog", data);
export const scheduleTask = (id: number | string, date: string) =>
    API.patch(`/tasks/${id}/schedule`, { date });
export const unscheduleTask = (id: number | string) => API.patch(`/tasks/${id}/unschedule`);
export const getTaskDetail = (id: number | string) => API.get(`/tasks/${id}/detail`);
export const getTaskHistory = (id: number | string) => API.get(`/tasks/${id}/history`);
export const searchTasks = (q: string) => API.get("/tasks/search", { params: { q } });
export const getAvailableSprints = () => API.get("/tasks/available-sprints");
export const assignTaskToSprint = (id: number | string, sprintId: number | string) =>
    API.patch(`/tasks/${id}/assign-sprint`, { sprint_id: sprintId });
export const rankTask = (
    id: number | string,
    neighbours: { beforeId: number | string | null; afterId: number | string | null },
) => API.patch(`/tasks/${id}/rank`, neighbours);
export const bulkTaskAction = (data: {
    ids: Array<number | string>;
    action: "move_to_sprint" | "status" | "assign" | "delete";
    value?: unknown;
}) => API.post("/tasks/bulk", data);
export const getTaskByKey = (key: string) => API.get(`/tasks/by-key/${encodeURIComponent(key)}`);
export const getEpics = () => API.get("/tasks/epics");
export const getSprintCompletionPreview = (id: number | string) =>
    API.get(`/sprints/${id}/completion-preview`);
export const getSprintBaseline = (id: number | string) => API.get(`/sprints/${id}/baseline`);
export const getScheduleOverlays = (from: string, to: string) =>
    API.get("/tasks/schedule-overlays", { params: { from, to } });
export const startTaskTimer = (id: number | string) => API.post(`/tasks/${id}/timer/start`);
export const stopTaskTimer = (id: number | string) => API.post(`/tasks/${id}/timer/stop`);
export const getTaskTimer = (id: number | string) => API.get(`/tasks/${id}/timer`);
export const getTaskTime = (from?: string, to?: string) =>
    API.get("/tracker/task-time", { params: { from, to } });

// Sprints
export const getSprints = (params?: AnyData) => API.get<SprintList>("/sprints", { params });
export const getActiveSprint = () => API.get("/sprints/active");
export const createSprint = (data: AnyData) => API.post("/sprints", data);
export const updateSprint = (id: number | string, data: AnyData) => API.put(`/sprints/${id}`, data);
export const deleteSprint = (id: number | string) => API.delete(`/sprints/${id}`);
export const getSprintTasks = (id: number | string) => API.get(`/sprints/${id}/tasks`);
export const getSprintBoard = (id: number | string, signal?: AbortSignal) =>
    API.get(`/sprints/${id}/board`, { signal });
export const getSprintStats = (id: number | string) => API.get(`/sprints/${id}/stats`);
export const startSprint = (id: number | string) => API.post(`/sprints/${id}/start`);
export const completeSprint = (id: number | string, rolloverTo?: number | string) =>
    API.post(`/sprints/${id}/complete`, { rolloverTo });
export const pauseSprint = (id: number | string) => API.post(`/sprints/${id}/pause`);
export const resumeSprint = (id: number | string) => API.post(`/sprints/${id}/resume`);
export const getSprintCarriedOver = (id: number | string) =>
    API.get(`/sprints/${id}/carried-over`);
export const getSprintBurndown = (id: number | string) => API.get(`/sprints/${id}/burndown`);
export const getRecentVelocity = (limit?: number) =>
    API.get("/sprints/velocity/recent", { params: { limit } });
// Phase 3 â€” Insights endpoints
export const getSprintCumulativeFlow = (id: number | string) =>
    API.get(`/sprints/${id}/cumulative-flow`);
export const getSprintCycleTime = (id: number | string) => API.get(`/sprints/${id}/cycle-time`);
export const getSprintRetrospective = (id: number | string) =>
    API.get(`/sprints/${id}/retrospective`);
export const updateSprintRetrospective = (id: number | string, data: AnyData) =>
    API.put(`/sprints/${id}/retrospective`, data);

// Pass 2 â€” task dependencies, acceptance criteria, blockers
export const getTaskDependencies = (id: number | string) => API.get(`/tasks/${id}/dependencies`);
export const addTaskDependency = (
    id: number | string,
    depends_on_id: number | string,
    type: string
) => API.post(`/tasks/${id}/dependencies`, { depends_on_id, type });
export const removeTaskDependency = (id: number | string, depId: number | string) =>
    API.delete(`/tasks/${id}/dependencies/${depId}`);
export const getAcceptanceCriteria = (id: number | string) =>
    API.get(`/tasks/${id}/acceptance-criteria`);
export const updateAcceptanceCriteria = (id: number | string, criteria: unknown) =>
    API.put(`/tasks/${id}/acceptance-criteria`, { criteria });
export const setTaskBlocker = (
    id: number | string,
    is_blocked: boolean,
    blocked_reason?: string
) => API.patch(`/tasks/${id}/block`, { is_blocked, blocked_reason });
export const quicksearchTasks = (q: string) =>
    API.get("/tasks/lookup/quicksearch", { params: { q } });
export const getTaskChildren = (id: number | string) => API.get(`/tasks/${id}/children`);
export const createTaskSubtask = (id: number | string, data: { title: string }) => API.post(`/tasks/${id}/subtasks`, data);
export const getTaskParent = (id: number | string) => API.get(`/tasks/${id}/parent`);
export const setTaskParent = (id: number | string, parent_task_id: number | string | null) =>
    API.patch(`/tasks/${id}/parent`, { parent_task_id });

// Agile (tenant-customisable Work Item Types, Workflow States, Story Points)
export const getAgileConfig = (projectId?: number) => API.get("/agile/config", {
    params: projectId == null ? undefined : { project_id: projectId },
});
export const getAgileSettings = () => API.get("/agile/settings");
export const updateAgileSettings = (data: AnyData) => API.put("/agile/settings", data);
export const getWorkItemTypes = () => API.get("/agile/work-item-types");
export const createWorkItemType = (data: AnyData) => API.post("/agile/work-item-types", data);
export const updateWorkItemType = (id: number | string, data: AnyData) =>
    API.put(`/agile/work-item-types/${id}`, data);
export const deleteWorkItemType = (id: number | string) =>
    API.delete(`/agile/work-item-types/${id}`);
export const reorderWorkItemTypes = (order: unknown) =>
    API.put("/agile/work-item-types/reorder", { order });
export const getWorkflowStates = () => API.get("/agile/workflow-states");
export const createWorkflowState = (data: AnyData) => API.post("/agile/workflow-states", data);
export const updateWorkflowState = (id: number | string, data: AnyData) =>
    API.put(`/agile/workflow-states/${id}`, data);
export const deleteWorkflowState = (id: number | string) =>
    API.delete(`/agile/workflow-states/${id}`);
export const reorderWorkflowStates = (order: unknown) =>
    API.put("/agile/workflow-states/reorder", { order });
// Agile permissions are role-based â€” this endpoint just returns the caller's
// effective access level (canEdit + role). The previous request/grant/review
// flow was removed: edit access is granted purely by role membership in
// server/middleware/agileEditor.js#ROLES_THAT_CAN_EDIT_AGILE.
export const getAgilePermissions = () => API.get("/agile/permissions/me");

// â”€â”€â”€ Custom Fields (Chunk 6) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Tenant-customisable extra fields shown on every task. Definitions are
// admin-managed; values live per-task and are coerced server-side based
// on the field's declared type.
export const getCustomFields = () => API.get("/custom-fields");
export const getCustomFieldsAll = () => API.get("/custom-fields/all");
export const createCustomField = (data: AnyData) => API.post("/custom-fields", data);
export const updateCustomField = (id: number | string, data: AnyData) =>
    API.put(`/custom-fields/${id}`, data);
export const deleteCustomField = (id: number | string) => API.delete(`/custom-fields/${id}`);
export const reorderCustomFields = (order: unknown) =>
    API.put("/custom-fields/reorder", { order });
export const getTaskCustomFieldValues = (taskId: number | string) =>
    API.get(`/custom-fields/task/${taskId}`);
export const updateTaskCustomFieldValues = (taskId: number | string, values: unknown) =>
    API.put(`/custom-fields/task/${taskId}`, { values });
