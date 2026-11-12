const retired = [
    /^\/api\/tasks\/(?:scheduled|carry-forward)\/?$/,
    /^\/api\/tasks\/[^/]+\/(?:schedule|unschedule|transfer|timer(?:\/start|\/stop)?)\/?$/,
    /^\/api\/org\/teams\/[^/]+\/sprint-config\/?$/,
    /^\/api\/projects\/migration(?:\/|$)/,
];
const fields = new Set([
    "planned_date", "pre_sprint_due_date", "issue_key", "logged_minutes", "estimated_minutes",
    "project_ownership", "project_ownership_switched_at",
]);
const retiredInputFields = new Set(fields);
const retiredBodyFields = new Set([...fields, "date"]);

export function isRetiredProjectTypesPath(path: string): boolean {
    return retired.some(pattern => pattern.test(path));
}

export function hasRetiredProjectTypesInput(path: string, query: Record<string, unknown>, body: unknown): boolean {
    if (!/^\/api\/(?:tasks|sprints)(?:\/|$)/.test(path)) return false;
    const retiredInput = (value: Record<string, unknown>, retiredFields: Set<string>) => Object.keys(value)
        .some(key => retiredFields.has(key) || key === "team_id" || key === "unassigned");
    return retiredInput(query, retiredInputFields) || (!!body && typeof body === "object" && !Array.isArray(body)
        && retiredInput(body as Record<string, unknown>, retiredBodyFields));
}

export function supportedProjectTypesPayload(value: any): any {
    if (Array.isArray(value)) return value.map(supportedProjectTypesPayload);
    if (!value || typeof value !== "object" || value instanceof Date || Buffer.isBuffer(value)) return value;
    const ticket = "ticket_key" in value || ("id" in value && "title" in value && "project_id" in value);
    const sprint = "id" in value && "project_id" in value && ("start_date" in value || "is_auto" in value) && !ticket;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !fields.has(key) && !((ticket || sprint) && [
            "team_id", "team_name", "is_auto", "auto_managed", "sprint_number",
        ].includes(key)))
        .map(([key, child]) => [key, key === "can" && child && typeof child === "object"
            ? supportedProjectTypesPayload(Object.fromEntries(Object.entries(child).filter(([action]) => !["schedule", "transfer"].includes(action))))
            : supportedProjectTypesPayload(child)]));
}
