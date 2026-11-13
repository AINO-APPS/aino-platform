/** Expand-stage ticket hierarchy contract, kept reproducible by the generator. */
export function applyHierarchyContract(paths, schemas) {
    const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
    const json = (schema) => ({ "application/json": { schema } });
    schemas.HierarchyRepairValue = {
        type: "object",
        properties: Object.fromEntries(["parent_task_id", "work_item_type_id", "project_id", "sprint_id", "story_points"]
            .map(name => [name, { type: [name === "story_points" ? "number" : "integer", "null"] }])),
        required: ["parent_task_id", "work_item_type_id", "project_id", "sprint_id", "story_points"],
        additionalProperties: false,
    };
    schemas.HierarchyRepairStage = { type: "string", enum: ["original", "correction"] };
    schemas.HierarchyRepair = {
        type: "object",
        properties: {
            task_id: { type: "integer" }, ticket_key: { type: ["string", "null"] },
            stage: ref("HierarchyRepairStage"), reason: { type: "string" },
            repaired_at: { type: "string", format: "date-time" },
            before: ref("HierarchyRepairValue"), after: ref("HierarchyRepairValue"),
        },
        required: ["task_id", "ticket_key", "stage", "reason", "repaired_at", "before", "after"],
        additionalProperties: false,
    };
    paths["/api/projects/hierarchy-repairs"] = { get: {
        tags: ["projects"], operationId: "get_api_projects_hierarchy_repairs",
        summary: "Review immutable hierarchy repairs and corrections for the current organization",
        security: [{ cookieAuth: [] }],
        responses: {
            "200": { description: "Organization-scoped original repairs and corrections, oldest first; web super-admin/platform-admin only.",
                content: json({ type: "object", properties: { hierarchy_repairs: { type: "array", items: ref("HierarchyRepair") } },
                    required: ["hierarchy_repairs"], additionalProperties: false }) },
            "401": { description: "Authentication required", content: json(ref("Error")) },
            "403": { description: "Web organization administrator required", content: json(ref("Error")) },
            "404": { description: "Organization not found", content: json(ref("Error")) },
            "500": { description: "Could not load hierarchy repairs", content: json(ref("Error")) },
        },
    } };
    const conflict = { description: "INVALID_HIERARCHY identifies a violated hierarchy rule; SUBTASK_FOLLOWS_PARENT refuses independent sprint/project placement; CANCELLED_TERMINAL refuses adding a subtask to a Cancelled parent.",
        content: json(ref("Error")) };
    for (const reason of ["INVALID_HIERARCHY", "SUBTASK_FOLLOWS_PARENT"]) {
        const reasons = schemas.TicketCapability.properties.reason.enum;
        if (!reasons.includes(reason)) reasons.push(reason);
    }
    const can = schemas.TicketCapabilities.properties.can;
    can.properties.canAddSubtask = ref("TicketCapability");
    if (!can.required.includes("canAddSubtask")) can.required.push("canAddSubtask");
    schemas.TicketSummary = {
        type: "object",
        properties: {
            id: { type: "integer" }, title: { type: "string" },
            ticket_key: { type: ["string", "null"] }, project_id: { type: "integer" },
            work_item_type_id: { type: ["integer", "null"] }, workflow_state_id: { type: ["integer", "null"] },
            is_subtask: { type: "boolean" }, state_name: { type: ["string", "null"] },
            parent_key: { type: ["string", "null"] }, parent_task_id: { type: ["integer", "null"] },
            completed_at: { type: ["string", "null"], format: "date-time" },
            time_spent_minutes: { type: "integer", minimum: 0 },
            remaining_estimate_minutes: { type: ["integer", "null"], minimum: 0 },
        },
        required: ["id", "title", "project_id", "ticket_key"],
        additionalProperties: true,
    };
    Object.assign(schemas.Task.properties, {
        is_subtask: { type: "boolean" }, is_epic: { type: "boolean" },
        parent_key: { type: ["string", "null"], description: "Subtask cards label their same-project parent's stored key." },
        subtasks: { type: "array", items: schemas.TicketSummary, description: "Backlog pages rank and paginate parents; their complete visible subtask families are nested here." },
        subtask_summary: {
            type: "object", properties: { total: { type: "integer", minimum: 0 }, done: { type: "integer", minimum: 0 } },
            required: ["total", "done"], additionalProperties: false,
        },
        effort: {
            type: "object",
            properties: Object.fromEntries(["own_time_spent_minutes", "total_time_spent_minutes",
                "own_remaining_estimate_minutes", "total_remaining_estimate_minutes"].map(name => [name, {
                type: name.includes("remaining") ? ["integer", "null"] : "integer", minimum: 0,
            }])),
            required: ["own_time_spent_minutes", "total_time_spent_minutes", "own_remaining_estimate_minutes", "total_remaining_estimate_minutes"],
            additionalProperties: false,
            description: "Computed on read from this ticket and its visible non-deleted direct subtasks; only non-deleted worklogs count. Own estimates remain independently editable.",
        },
    });
    schemas.TaskDetail = {
        allOf: [ref("Task"), {
            type: "object",
            properties: {
                parent: { anyOf: [ref("TicketSummary"), { type: "null" }], description: "Null when absent or inaccessible to the caller." },
                subtasks: { type: "array", items: ref("TicketSummary"), description: "Visible direct Subtasks only." },
                subtask_summary: schemas.Task.properties.subtask_summary,
                effort: schemas.Task.properties.effort,
                comments: { type: "array", items: ref("FreeFormObject") },
            },
            required: ["parent", "subtasks", "subtask_summary", "effort", "comments"],
        }],
    };
    schemas.CreateSubtaskRequest = {
        type: "object",
        properties: Object.fromEntries(["title", "description", "priority", "assigned_to", "start_date", "due_date"]
            .map((key) => [key, schemas.CreateTicketRequest.properties[key]])),
        required: ["title"],
        additionalProperties: true,
        description: "The path fixes the parent and Subtask type. Project and sprint are inherited atomically; supplied container/type/parent fields never override them.",
    };
    const endpoint = paths["/api/tasks/{id}/subtasks"] ??= {};
    endpoint.post = {
        tags: ["tasks"], operationId: "post_api_tasks_id_subtasks", summary: "Add a Subtask in its parent's project and sprint",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } },
            { $ref: "#/components/parameters/CsrfHeader" }],
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: { required: true, content: json(ref("CreateSubtaskRequest")) },
        responses: {
            "200": { description: "Created Subtask with server capabilities", content: json(ref("Task")) },
            "400": { description: "Invalid fields", content: json(ref("Error")) },
            "401": { description: "Authentication required", content: json(ref("Error")) },
            "403": { description: "Parent is not writable by the caller", content: json(ref("Error")) },
            "404": { description: "Parent not found", content: json(ref("Error")) },
            "409": conflict,
        },
    };
    paths["/api/tasks/{id}/detail"].get.responses["200"].content = json(ref("TaskDetail"));
    for (const [path, method] of [
        ["/api/tasks", "post"], ["/api/tasks/backlog", "post"], ["/api/tasks/{id}", "put"],
        ["/api/tasks/{id}/parent", "patch"], ["/api/tasks/{id}/assign-sprint", "patch"],
        ["/api/tasks/{id}/move-project", "post"], ["/api/tasks/{id}/move-project/preview", "post"],
    ]) {
        if (paths[path]?.[method]) {
            const existing = paths[path][method].responses["409"];
            paths[path][method].responses["409"] = existing
                ? { ...existing, description: `${existing.description} ${conflict.description}` } : conflict;
        }
    }
}
