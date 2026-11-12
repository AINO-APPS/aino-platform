/**
 * Query scope for the ticket export.
 *
 * "My tasks" used to mean "tickets I created" — one of the divergent
 * visibility rules this change removes. The export now uses the same
 * project-role policy as every Plan list.
 */

import {
    buildVisibilityPredicate,
    resolveTaskVisibilityForRequest,
    type TaskActor,
} from "./tasks.policy";

export interface TaskExportScope {
    whereSql: string;
    params: unknown[];
}

export async function buildTaskExportScope(
    actor: TaskActor,
    options: { orgId: number | null; from?: string; to?: string },
): Promise<TaskExportScope> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let nextIndex = 1;

    if (options.orgId != null) {
        conditions.push(`t.org_id = $${nextIndex++}`);
        params.push(options.orgId);
    } else {
        conditions.push("t.org_id IS NULL");
    }

    const visibility = buildVisibilityPredicate(await resolveTaskVisibilityForRequest(actor), nextIndex);
    if (visibility.sql) {
        conditions.push(visibility.sql);
        params.push(...visibility.params);
        nextIndex = visibility.nextIndex;
    }

    if (options.from && options.to) {
        conditions.push(`t.start_date BETWEEN $${nextIndex} AND $${nextIndex + 1}`);
        params.push(options.from, options.to);
    }

    return { whereSql: conditions.join(" AND "), params };
}
