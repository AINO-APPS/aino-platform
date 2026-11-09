/** Preserve the list/calendar slice when regenerating the expanded task contract. */
export function applyTaskCollectionContract(paths, schemas) {
    const operation = paths["/api/tasks"].get;
    const scope = operation.parameters.find(parameter => parameter.name === "scope");
    scope.schema.enum = ["personal", "list", "calendar"];
    scope.description = "personal shows the actor's tickets. list returns all project tickets, independent of dates/sprints. calendar returns open, non-Cancelled project tickets overlapping an inclusive date range, or undated work. list/calendar require project_id and project access; sprint_id is refused.";
    const parameter = (name, schema, description) => ({ name, in: "query", ...(description ? { description } : {}), schema });
    const date = { type: "string", format: "date" };
    operation.parameters.push(
        parameter("date", date, "Single inclusive calendar day; either single date appears on its own day, and spans include both boundaries."),
        parameter("start_date", date, "Inclusive calendar range start. Matches start <= range end and due >= range start, coalescing either missing date to the other."),
        parameter("end_date", date, "Inclusive calendar range end; must not precede start_date."),
        parameter("undated", { type: "string", enum: ["1"] }, "calendar only: return open tickets with neither date instead of the range."),
        parameter("key", { type: "string" }, "Case-insensitive literal ticket-key substring."),
        parameter("title", { type: "string" }, "Case-insensitive literal title substring."),
        parameter("work_item_type_id", { type: "integer", minimum: 1 }),
        parameter("status", { type: "string" }, "Project workflow-state key."),
        parameter("assignee", { type: "string" }, "User ID, me, or unassigned. list/calendar match the actual assignee, not the reporter."),
        parameter("priority", { type: "string", enum: ["high", "medium", "low"] }),
        parameter("start_on", date, "Exact start-date filter."),
        parameter("due_on", date, "Exact due-date filter."),
        parameter("sort", { type: "string", enum: ["key", "title", "type", "status", "assignee", "priority", "start_date", "due_date"] }, "list only. Priority ascending is high-first. Nulls always last; ID breaks ties."),
        parameter("direction", { type: "string", enum: ["asc", "desc"], default: "asc" }),
        parameter("offset", { type: "integer", minimum: 0, default: 0 }, "list/calendar only. Pages contain at most 500 tickets; advance by returned count while pagination.hasMore is true."),
    );
    operation.responses["200"].content["application/json"].schema = { $ref: "#/components/schemas/TaskCollectionResponse" };
    schemas.Task.properties.assignee = {
        type: ["object", "null"], description: "Enriched assignee summary, null for unassigned tickets.",
        properties: { username: { type: "string" }, full_name: { type: ["string", "null"] }, avatar: { type: ["string", "null"] } },
        required: ["username", "full_name", "avatar"], additionalProperties: false,
    };
    schemas.TaskCollectionResponse = {
        type: "object", description: "Enriched task collection. list/calendar include pagination; legacy date/sprint reads omit it.",
        properties: {
            tasks: { type: "array", items: { $ref: "#/components/schemas/Task" } },
            stats: { type: "object", properties: {
                total: { type: "integer", minimum: 0 }, done: { type: "integer", minimum: 0 },
                inProgress: { type: "integer", minimum: 0 }, percent: { type: "integer", minimum: 0, maximum: 100 },
            }, required: ["total", "done", "inProgress", "percent"], additionalProperties: false },
            pagination: { type: "object", properties: { offset: { type: "integer", minimum: 0 }, hasMore: { type: "boolean" } },
                required: ["offset", "hasMore"], additionalProperties: false },
        }, required: ["tasks", "stats"], additionalProperties: false,
    };
}
