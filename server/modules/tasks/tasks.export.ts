/**
 * Query scope for the ticket export.
 *
 * "My tasks" used to mean "tickets I created" — one of the divergent
 * visibility rules this change removes. The export now uses the same policy as
 * every Plan list, so a team member exports the team's tickets and a user
 * without a team exports only their own.
 */

import {
    buildVisibilityPredicate,
    resolveTaskVisibility,
    type TaskActor,
} from "./tasks.policy";

export interface TaskExportScope {
    whereSql: string;
    params: unknown[];
}

export function buildTaskExportScope(
    actor: TaskActor,
    options: { orgId: number | null; from?: string; to?: string },
): TaskExportScope {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let nextIndex = 1;

    if (options.orgId != null) {
        conditions.push(`t.org_id = $${nextIndex++}`);
        params.push(options.orgId);
    } else {
        conditions.push("t.org_id IS NULL");
    }

    // The export used to be creator-only. With the flag off it stays that way.
    if (!actor.teamVisibility) {
        conditions.push(`t.user_id = $${nextIndex++}`);
        params.push(actor.userId);
    } else {
        const visibility = buildVisibilityPredicate(resolveTaskVisibility(actor), nextIndex);
        if (visibility.sql) {
            conditions.push(visibility.sql);
            params.push(...visibility.params);
            nextIndex = visibility.nextIndex;
        }
    }

    if (options.from && options.to) {
        conditions.push(`t.planned_date BETWEEN $${nextIndex} AND $${nextIndex + 1}`);
        params.push(options.from, options.to);
    }

    return { whereSql: conditions.join(" AND "), params };
}
