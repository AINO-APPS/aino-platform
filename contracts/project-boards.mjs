export function applyProjectBoardContract(paths, schemas) {
    const ref = name => ({ $ref: `#/components/schemas/${name}` });
    const response = name => ({ description: name, content: { "application/json": { schema: ref(name) } } });
    schemas.Project.properties.enable_wip_limits = { type: "boolean", default: false, description: "Project WIP switch; copied once from the former org switch during expansion." };
    schemas.Task.properties.sprint_end_date = { type: ["string", "null"], format: "date", description: "Board-only Scrum sprint end date, separate from the ticket due date." };
    schemas.SprintBoardColumn.properties.count.description = "Occupancy in this project's board column: selected sprint for Scrum, continuous project population otherwise. Done has a 14-day window and Cancelled never appears.";
    schemas.SprintBoardColumn.properties.state = ref("WorkflowState");
    schemas.ProjectBoard = {
        type: "object", properties: {
            project: ref("Project"), sprint: { anyOf: [ref("Sprint"), { type: "null" }] },
            columns: { type: "array", items: ref("SprintBoardColumn") },
            tickets: { type: "array", items: ref("Task") },
        }, required: ["project", "sprint", "columns", "tickets"], additionalProperties: false,
    };
    schemas.ProjectBoardSettings = {
        type: "object", properties: { enable_wip_limits: { type: "boolean" }, kanban_backlog_enabled: { type: "boolean" } },
        additionalProperties: false,
    };
    for (const [suffix, operationId, summary] of [
        ["board", "getProjectBoard", "Project board for any project type"],
        ["backlog", "getProjectBacklog", "Project backlog: unsprinted Scrum work or Kanban initial-state work"],
    ]) {
        const operation = paths[`/api/projects/{id}/${suffix}`].get;
        Object.assign(operation, { operationId, summary,
            description: "Any project role may read; foreign or inaccessible projects return 404. Kanban and Task list have no sprints. An optional Kanban backlog excludes initial-state tickets from the board. No date field affects membership.",
            responses: { ...operation.responses, "200": response("ProjectBoard"), "409": { description: "PROJECT_HAS_NO_SPRINTS or PROJECT_HAS_NO_BACKLOG" } },
        });
        if (suffix === "board") operation.parameters.push({ name: "sprint_id", in: "query", required: false, schema: { type: "integer", minimum: 1 }, description: "Scrum only; defaults to current active or paused sprint." });
    }
    const settings = paths["/api/projects/{id}/board-settings"].patch;
    Object.assign(settings, {
        operationId: "updateProjectBoardSettings", summary: "Change project board settings (project admin only)",
        description: "Non-archived projects only. kanban_backlog_enabled applies only to Kanban; limits themselves are configured on the project workflow states. WIP capacity remains a final write guard, not a ticket capability.",
        requestBody: { required: true, content: { "application/json": { schema: ref("ProjectBoardSettings") } } },
        responses: { ...settings.responses, "200": response("Project"), "409": { description: "PROJECT_ARCHIVED or PROJECT_HAS_NO_KANBAN_BACKLOG" } },
    });
}
