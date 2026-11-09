/** Expand-stage ticket hierarchy contract, kept reproducible by the generator. */
export function applyHierarchyContract(paths, schemas) {
    const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
    const json = (schema) => ({ "application/json": { schema } });
    const conflict = { description: "INVALID_HIERARCHY identifies a violated hierarchy rule; SUBTASK_FOLLOWS_PARENT refuses independent sprint/project placement.",
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
        },
        required: ["id", "title", "project_id", "ticket_key"],
        additionalProperties: true,
    };
    schemas.TaskDetail = {
        allOf: [ref("Task"), {
            type: "object",
            properties: {
                parent: { anyOf: [ref("TicketSummary"), { type: "null" }], description: "Null when absent or inaccessible to the caller." },
                subtasks: { type: "array", items: ref("TicketSummary"), description: "Visible direct Subtasks only; no new rollups." },
                comments: { type: "array", items: ref("FreeFormObject") },
            },
            required: ["parent", "subtasks", "comments"],
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
