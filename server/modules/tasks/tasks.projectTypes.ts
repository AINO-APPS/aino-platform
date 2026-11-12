export type ProjectRole = "project_admin" | "member" | "viewer";
export type ProjectType = "scrum" | "kanban" | "task_list";
export type PlanTab = "backlog" | "sprint" | "reports" | "board" | "list" | "calendar";
export interface TypedProject {
    type?: ProjectType;
    kanban_backlog_enabled?: boolean;
}

export function isProjectType(value: unknown): value is ProjectType {
    return value === "scrum" || value === "kanban" || value === "task_list";
}

export function availableProjectTypes(agile: boolean): ProjectType[] {
    return agile ? ["scrum", "kanban", "task_list"] : ["task_list"];
}

export function projectTypePolicy(project: TypedProject) {
    const type = project.type ?? "scrum";
    const hasSprints = type === "scrum";
    const hasBacklog = hasSprints || type === "kanban" && project.kanban_backlog_enabled === true;
    const planTabs: PlanTab[] = hasSprints ? ["backlog", "sprint", "reports"]
        : type === "kanban" ? hasBacklog ? ["backlog", "board"] : ["board"]
            : ["list", "board", "calendar"];
    return {
        planTabs, hasSprints, hasBacklog,
        boardScope: hasSprints ? "current_sprint" : hasBacklog ? "open_except_initial" : "open_tickets",
        doneWindowDays: 14, includeCancelled: false,
    };
}

export function projectTypeChangeRefusal(
    from: ProjectType, to: ProjectType, agile: boolean, sprintStatuses: readonly string[],
): "PROJECT_TYPE_NOT_AVAILABLE" | "PROJECT_HAS_OPEN_SPRINTS" | null {
    if (from === to) return null;
    if (!availableProjectTypes(agile).includes(to)) return "PROJECT_TYPE_NOT_AVAILABLE";
    if (from === "scrum" && sprintStatuses.some((status) => ["planned", "active", "paused"].includes(status))) {
        return "PROJECT_HAS_OPEN_SPRINTS";
    }
    return null;
}
