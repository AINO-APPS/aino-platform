export const projectTypesRetiredOperations = [
    ["GET", "/api/tasks/scheduled"],
    ["PATCH", "/api/tasks/:id/schedule"],
    ["PATCH", "/api/tasks/:id/unschedule"],
    ["POST", "/api/tasks/carry-forward"],
    ["GET", "/api/tasks/:id/timer"],
    ["POST", "/api/tasks/:id/timer/start"],
    ["POST", "/api/tasks/:id/timer/stop"],
    ["POST", "/api/tasks/:id/transfer"],
    ["GET", "/api/org/teams/:id/sprint-config"],
    ["PUT", "/api/org/teams/:id/sprint-config"],
    ["POST", "/api/projects/migration/switch"],
    ["POST", "/api/projects/migration/switch-back"],
    ["GET", "/api/projects/migration/review"],
];

const retiredFields = ["planned_date", "pre_sprint_due_date", "issue_key", "logged_minutes", "estimated_minutes"];
const retiredTicketFields = [...retiredFields, "team_id"];
const retiredSprintFields = ["team_id", "team_name", "auto_managed", "is_auto", "sprint_number"];
const operations = new Set(projectTypesRetiredOperations.map(([method, path]) => `${method} ${path}`));

export function isProjectTypesRetiredOperation(method, path) {
    return operations.has(`${method} ${path.replace(/\{([^}]+)\}/g, ":$1")}`);
}

export function applyProjectTypesRemovalContract(paths, schemas) {
    for (const [path, methods] of Object.entries(paths)) {
        for (const method of Object.keys(methods)) {
            if (isProjectTypesRetiredOperation(method.toUpperCase(), path)) delete methods[method];
        }
        if (Object.keys(methods).length === 0) delete paths[path];
    }

    for (const name of ["Task", "SearchTask", "TaskByKey", "WorklogTicketSummary", "TaskTimeEntry"]) {
        const schema = schemas[name];
        if (!schema?.properties) continue;
        const removed = name === "Task" || name === "SearchTask" ? retiredTicketFields
            : name === "TaskByKey" || name === "TaskTimeEntry" ? ["issue_key"]
                : retiredFields;
        for (const field of removed) delete schema.properties[field];
        if (Array.isArray(schema.required)) schema.required = schema.required.filter((field) => !removed.includes(field));
    }
    for (const name of ["Sprint", "CreateSprintRequest"]) {
        const schema = schemas[name];
        if (!schema?.properties) continue;
        for (const field of [...retiredSprintFields, ...(name === "CreateSprintRequest" ? ["team_id"] : [])]) {
            delete schema.properties[field];
        }
        if (Array.isArray(schema.required)) schema.required = schema.required.filter((field) => !retiredSprintFields.includes(field) && field !== "team_id");
    }
    if (schemas.Task?.properties?.container) schemas.Task.properties.container.enum = ["sprint", "backlog", "board"];
    if (schemas.SearchTask?.properties?.container) schemas.SearchTask.properties.container.enum = ["sprint", "backlog", "board"];
    if (schemas.TicketCapabilities?.properties?.can?.properties) {
        delete schemas.TicketCapabilities.properties.can.properties.schedule;
        delete schemas.TicketCapabilities.properties.can.properties.transfer;
        schemas.TicketCapabilities.properties.can.required = schemas.TicketCapabilities.properties.can.required
            .filter((action) => !["schedule", "transfer"].includes(action));
    }
    if (schemas.Profile?.allOf?.[1]?.properties) delete schemas.Profile.allOf[1].properties.project_ownership;
    delete schemas.TaskTimerState;
    delete schemas.TaskTimerStopResponse;
    delete schemas.ProjectOwnershipState;
    for (const name of ["ProjectMigrationGrant", "ProjectMigrationProject", "ProjectMigrationMove", "ProjectMigrationReview"]) {
        delete schemas[name];
    }

    for (const [path, methods] of Object.entries(paths)) {
        for (const operation of Object.values(methods)) {
            if (Array.isArray(operation.parameters)) {
                operation.parameters = operation.parameters.filter((parameter) => !["team_id", "unassigned"].includes(parameter.name));
            }
        }
    }
    return paths;
}
