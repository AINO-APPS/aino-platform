export function applyProjectMoveContract(paths, schemas) {
    const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
    const json = (schema) => ({ "application/json": { schema } });
    const object = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
    schemas.TicketCapabilities.properties.can.properties.canMoveProject = ref("TicketCapability");
    schemas.TicketCapabilities.properties.can.required = [...new Set([...schemas.TicketCapabilities.properties.can.required, "canMoveProject"])];
    schemas.ProjectMoveRequest = object({ project_id: { type: "integer", minimum: 1 } });
    schemas.ProjectMovePreview = object({
        target_project_id: { type: "integer" },
        key_format: { type: "string", description: "Target prefix and <number>, not a reserved ticket number.", examples: ["DEST-<number>"] },
        workflow_state: object({
            id: { type: "integer" }, key: { type: "string" }, name: { type: "string" },
            category: { type: "string", enum: ["open", "in_progress", "in_review", "done"] },
        }),
        leaves_sprint: { type: "boolean" },
    });
    schemas.ProjectMoveResponse = object({
        task: ref("Task"), moved: { const: true },
        cleared_sprint: { type: ["object", "null"], properties: { id: { type: "integer" }, name: { type: "string" } }, required: ["id", "name"], additionalProperties: false },
    });
    for (const preview of [true, false]) {
        paths[`/api/tasks/{id}/move-project${preview ? "/preview" : ""}`] = {
            post: {
                tags: ["tasks"], operationId: preview ? "previewTaskProjectMove" : "moveTaskProject",
                summary: preview ? "Preview a project move without writes" : "Move a ticket transactionally to another project",
                description: "Requires project ownership and member or project-admin in both active projects. Maps state by active key, first active category, then initial state. A move allocates a new key, aliases the old key, clears the source project's sprint and records history/audit; task_updated follows commit. Legacy team ownership is retained. A preview reserves no sequence and may become stale before confirmation.",
                security: [{ cookieAuth: [] }, { bearerAuth: [] }],
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } }, { $ref: "#/components/parameters/CsrfHeader" }],
                requestBody: { required: true, content: json(ref("ProjectMoveRequest")) },
                responses: {
                    200: { description: "Success", content: json(ref(preview ? "ProjectMovePreview" : "ProjectMoveResponse")) },
                    400: { description: "Invalid id or unchanged project", content: json(ref("Error")) },
                    401: { description: "Authentication required", content: json(ref("Error")) },
                    403: { description: "ACCESS_DENIED or READ_ONLY_ROLE", content: json(ref("Error")) },
                    404: { description: "Ticket or same-org project not found", content: json(ref("Error")) },
                    409: { description: "PROJECT_ARCHIVED or WORKFLOW_NOT_FOUND", content: json(ref("Error")) },
                },
            },
        };
    }
}
