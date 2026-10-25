/**
 * The reported bug, encoded as a test:
 *
 *   "In the tasks backlog, if a ticket is completed, those completed items are
 *    also visible in the backlog."
 *
 * Mark done → absent from the open list → present under Completed → the count
 * matches → the toggle reveals and hides it again.
 */
import {
    buildTaskCollection,
    buildCompletedQuery,
} from "../modules/tasks/tasks.collection";

const visibility = { kind: "team" as const, userId: 7, teamId: 3 };

function backlog(includeCompleted: boolean) {
    return buildTaskCollection({
        scope: "backlog",
        orgId: 1,
        visibility,
        filters: { completed: includeCompleted ? "all" : "incomplete" },
    });
}

describe("completed work leaves the backlog", () => {
    test("the open backlog excludes completed tasks", () => {
        const open = backlog(false);
        expect(open.whereSql).toContain("t.completed_at IS NULL");
        expect(open.whereSql).not.toContain("t.completed_at IS NOT NULL");
    });

    test("the completed section returns only completed tasks", () => {
        const completed = buildCompletedQuery({ scope: "backlog", orgId: 1, visibility });
        expect(completed.whereSql).toContain("t.completed_at IS NOT NULL");
        expect(completed.whereSql).not.toContain("t.completed_at IS NULL");
    });

    test("revealing completed work keeps the same filters and visibility", () => {
        const open = backlog(false);
        const revealed = backlog(true);

        // Same container, tenant and visibility predicates.
        expect(revealed.whereSql).toContain("t.sprint_id IS NULL");
        expect(revealed.whereSql).toContain("t.org_id = $1");
        expect(revealed.whereSql).toContain("(t.user_id = $2 OR t.assigned_to = $2 OR t.user_id IN (SELECT id FROM users WHERE team_id = $3))");
        expect(revealed.params).toEqual(open.params);

        // Only the completed rule differs.
        expect(open.whereSql).toContain("t.completed_at IS NULL");
        expect(revealed.whereSql).not.toContain("t.completed_at IS NULL");
    });

    test("a planned date never removes a task from the backlog", () => {
        const open = backlog(false);
        expect(open.whereSql).not.toContain("t.date IS NULL");
        expect(open.whereSql).not.toContain("t.planned_date IS NULL");
    });

    test("the completed window is applied only to the completed query", () => {
        const completed = buildCompletedQuery({
            scope: "backlog",
            orgId: 1,
            visibility,
            filters: { completedSince: "2026-09-25" },
        });
        expect(completed.whereSql).toContain("t.completed_at >= $4");
        expect(completed.params).toContain("2026-09-25");
    });

    test("sorting never resurrects completed items", () => {
        // Ordering is a separate clause from the completed rule, so no sort can
        // reintroduce a completed row into the open list.
        const open = backlog(false);
        expect(open.orderSql).not.toContain("completed_at");
        expect(open.whereSql).toContain("t.completed_at IS NULL");
    });
});
