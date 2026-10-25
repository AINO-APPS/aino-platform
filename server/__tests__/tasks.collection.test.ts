/**
 * The task-collection builder is the single source of the filter, ordering and
 * completed rules. These tests prove the three callers (backlog, board,
 * schedule) cannot produce different results for the same filter input.
 */
import {
    buildTaskCollection,
    buildCompletedQuery,
    COMPLETED_PREDICATE,
    INCOMPLETE_PREDICATE,
} from "../modules/tasks/tasks.collection";

const visibility = { kind: "team" as const, userId: 7, teamId: 3 };
const filters = { assignee: "me", priority: "high", search: "refund" };

function normalise(sql: string): string {
    return sql.replace(/\s+/g, " ").trim();
}

/** Parameter numbers depend on the container predicate, so compare shapes. */
function withoutParamNumbers(sql: string): string {
    return normalise(sql).replace(/\$\d+/g, "$?");
}

describe("task collection builder", () => {
    test("applies identical filters and visibility for every scope", () => {
        const backlog = buildTaskCollection({ scope: "backlog", orgId: 1, visibility, filters });
        const board = buildTaskCollection({ scope: "board", orgId: 1, visibility, filters, sprintId: 12 });
        const schedule = buildTaskCollection({ scope: "schedule", orgId: 1, visibility, filters, date: "2026-10-25" });

        const sharedFilters = [
            "t.org_id = $?",
            "(t.user_id = $? OR t.assigned_to = $? OR t.user_id IN (SELECT id FROM users WHERE team_id = $?))",
            "(t.assigned_to = $? OR (t.user_id = $? AND t.assigned_to IS NULL))",
            "t.priority = $?",
            "(t.title ILIKE $? ESCAPE '\\' OR t.description ILIKE $? ESCAPE '\\')",
        ];

        for (const collection of [backlog, board, schedule]) {
            const shape = withoutParamNumbers(collection.whereSql);
            for (const fragment of sharedFilters) {
                expect(shape).toContain(fragment);
            }
            expect(collection.params).toContain(1);
            expect(collection.params).toContain(7);
            expect(collection.params).toContain(3);
            expect(collection.params).toContain("high");
            expect(collection.params).toContain("%refund%");
        }
    });

    test("differs only in the container predicate", () => {
        const backlog = buildTaskCollection({ scope: "backlog", orgId: 1, visibility });
        const board = buildTaskCollection({ scope: "board", orgId: 1, visibility, sprintId: 12 });
        const schedule = buildTaskCollection({ scope: "schedule", orgId: 1, visibility, date: "2026-10-25" });

        expect(backlog.whereSql).toContain("t.sprint_id IS NULL");
        expect(board.whereSql).toMatch(/t\.sprint_id = \$\d+/);
        expect(schedule.whereSql).toMatch(/t\.date = \$\d+/);

        const shared = "t.org_id = $? AND (t.user_id = $? OR t.assigned_to = $? OR t.user_id IN (SELECT id FROM users WHERE team_id = $?))";
        expect(withoutParamNumbers(backlog.whereSql)).toContain(shared);
        expect(withoutParamNumbers(board.whereSql)).toContain(shared);
        expect(withoutParamNumbers(schedule.whereSql)).toContain(shared);
    });

    test("defines completion in exactly one place", () => {
        const backlog = buildTaskCollection({
            scope: "backlog", orgId: 1, visibility, filters: { completed: "incomplete" },
        });
        const board = buildTaskCollection({
            scope: "board", orgId: 1, visibility, sprintId: 4, filters: { completed: "incomplete" },
        });
        const schedule = buildTaskCollection({
            scope: "schedule", orgId: 1, visibility, date: "2026-10-25", filters: { completed: "incomplete" },
        });

        for (const collection of [backlog, board, schedule]) {
            expect(collection.whereSql).toContain(INCOMPLETE_PREDICATE);
            expect(collection.whereSql).not.toContain("status = 'done'");
            expect(collection.whereSql).not.toContain("workflow_states");
        }
    });

    test("completed-only queries share the same completed predicate", () => {
        const completed = buildCompletedQuery({ scope: "backlog", orgId: 1, visibility });
        expect(completed.whereSql).toContain(COMPLETED_PREDICATE);
        expect(completed.whereSql).not.toContain(INCOMPLETE_PREDICATE);
    });

    test("ignores invalid filter values instead of erroring", () => {
        const collection = buildTaskCollection({
            scope: "backlog",
            orgId: 1,
            visibility,
            filters: { priority: "urgent", status: "archived", label: "abc", projectId: "x" },
        });

        expect(collection.whereSql).not.toContain("t.priority");
        expect(collection.whereSql).not.toContain("t.status");
        expect(collection.whereSql).not.toContain("task_label_map");
        expect(collection.whereSql).not.toContain("t.project_id");
    });

    test("keeps the legacy scheduled-task exclusion opt-in", () => {
        const withoutLegacy = buildTaskCollection({ scope: "backlog", orgId: 1, visibility });
        const withLegacy = buildTaskCollection({
            scope: "backlog", orgId: 1, visibility, filters: { excludeScheduled: true },
        });

        expect(withoutLegacy.whereSql).not.toContain("t.date IS NULL");
        expect(withLegacy.whereSql).toContain("t.date IS NULL");
    });

    test("orders each scope deterministically", () => {
        const backlog = buildTaskCollection({ scope: "backlog", orgId: 1, visibility });
        const board = buildTaskCollection({ scope: "board", orgId: 1, visibility, sprintId: 1 });
        const schedule = buildTaskCollection({ scope: "schedule", orgId: 1, visibility, date: "2026-10-25" });

        expect(normalise(backlog.orderSql)).toContain("t.created_at DESC");
        expect(normalise(board.orderSql)).toBe("t.created_at ASC");
        expect(normalise(schedule.orderSql)).toContain("t.created_at ASC");
    });
});
