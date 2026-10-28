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
            "t.team_id = $?",
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
        expect(schedule.whereSql).toMatch(/t\.planned_date = \$\d+/);

        const shared = "t.org_id = $? AND t.team_id = $?";
        expect(withoutParamNumbers(backlog.whereSql)).toContain(shared);
        expect(withoutParamNumbers(board.whereSql)).toContain(shared);
        expect(withoutParamNumbers(schedule.whereSql)).toContain(shared);
    });

    test("flag off restores the creator-team predicate", () => {
        const legacy = { kind: "legacy-team" as const, userId: 7, teamId: 3 };
        const backlog = buildTaskCollection({ scope: "backlog", orgId: 1, visibility: legacy });
        expect(withoutParamNumbers(backlog.whereSql)).toContain(
            "(t.user_id = $? OR t.assigned_to = $? OR t.user_id IN (SELECT id FROM users WHERE team_id = $?))",
        );
        expect(backlog.params).toEqual([1, 7, 3]);
    });

    test("admins may request the unassigned bucket", () => {
        const backlog = buildTaskCollection({
            scope: "backlog",
            orgId: 1,
            visibility: { kind: "unassigned" },
        });
        expect(backlog.whereSql).toContain("t.team_id IS NULL");
        expect(backlog.params).toEqual([1]);
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
            filters: { priority: "urgent", status: "not a key!", label: "abc", projectId: "x" },
        });

        expect(collection.whereSql).not.toContain("t.priority");
        expect(collection.whereSql).not.toContain("workflow_states");
        expect(collection.whereSql).not.toContain("task_label_map");
        expect(collection.whereSql).not.toContain("t.project_id");
    });

    test("filters by workflow-state key, never by a status column", () => {
        const collection = buildTaskCollection({
            scope: "backlog", orgId: 1, visibility, filters: { status: "in_review" },
        });

        expect(collection.whereSql).toContain("workflow_states");
        expect(collection.whereSql).not.toContain("t.status");
        expect(collection.params).toContain("in_review");
    });

    test("never reads the legacy date column", () => {
        const backlog = buildTaskCollection({ scope: "backlog", orgId: 1, visibility });
        const schedule = buildTaskCollection({ scope: "schedule", orgId: 1, visibility, date: "2026-10-25" });

        for (const collection of [backlog, schedule]) {
            expect(collection.whereSql).not.toMatch(/t\.date\b/);
            expect(collection.orderSql).not.toMatch(/t\.date\b/);
        }
    });

    describe("container placement (sprint > planned day > backlog)", () => {
        test("the backlog holds tickets with no sprint and no planned day, whatever their due date", () => {
            const backlog = normalise(buildTaskCollection({ scope: "backlog", orgId: 1, visibility }).whereSql);
            expect(backlog).toContain("t.sprint_id IS NULL");
            expect(backlog).toContain("t.planned_date IS NULL");
            // A due date is a deadline, not a container: it must not hide the
            // ticket from the backlog it was created in.
            expect(backlog).not.toContain("t.due_date");
        });

        test("the backlog's Completed section lists finished tickets whatever their dates", () => {
            const counted = normalise(buildCompletedQuery({ scope: "backlog", orgId: 1, visibility }).whereSql);
            const listed = normalise(buildTaskCollection({
                scope: "backlog", orgId: 1, visibility, filters: { completed: "completed" },
            }).whereSql);
            for (const completed of [counted, listed]) {
                expect(completed).toContain("t.sprint_id IS NULL");
                expect(completed).not.toContain("t.planned_date IS NULL");
                expect(completed).not.toContain("t.due_date IS NULL");
            }
        });

        test("scheduled holds every unsprinted ticket with a planned day, with no window", () => {
            const scheduled = buildTaskCollection({ scope: "scheduled", orgId: 1, visibility, today: "2026-10-28" });
            const sql = normalise(scheduled.whereSql);
            expect(sql).toContain("t.sprint_id IS NULL");
            expect(sql).toContain("t.planned_date IS NOT NULL");
            expect(sql).not.toMatch(/planned_date <= \$/);
        });

        test("scheduled drops completed history older than 30 days", () => {
            const scheduled = buildTaskCollection({ scope: "scheduled", orgId: 1, visibility, today: "2026-10-28" });
            expect(normalise(scheduled.whereSql)).toContain("t.completed_at IS NULL OR t.completed_at >=");
            expect(scheduled.params).toContain("2026-09-28");
        });

        test("a planned-date range never returns tickets that are in a sprint", () => {
            const range = buildTaskCollection({
                scope: "schedule", orgId: 1, visibility, startDate: "2026-10-01", endDate: "2026-10-31",
            });
            expect(normalise(range.whereSql)).toContain("t.sprint_id IS NULL");
        });

        test("scheduled applies the same filters and visibility as the backlog", () => {
            const backlog = buildTaskCollection({ scope: "backlog", orgId: 1, visibility, filters });
            const scheduled = buildTaskCollection({ scope: "scheduled", orgId: 1, visibility, filters, today: "2026-10-28" });
            for (const shared of ["t.team_id = $?", "t.priority = $?"]) {
                expect(withoutParamNumbers(backlog.whereSql)).toContain(shared);
                expect(withoutParamNumbers(scheduled.whereSql)).toContain(shared);
            }
        });
    });

    test("orders each scope deterministically", () => {
        const backlog = buildTaskCollection({ scope: "backlog", orgId: 1, visibility });
        const board = buildTaskCollection({ scope: "board", orgId: 1, visibility, sprintId: 1 });
        const schedule = buildTaskCollection({ scope: "schedule", orgId: 1, visibility, date: "2026-10-25" });

        // The backlog uses the stored manual rank, so a temporary sort never
        // rewrites it.
        expect(normalise(backlog.orderSql)).toContain("t.rank ASC");
        expect(normalise(board.orderSql)).toBe("t.created_at ASC");
        expect(normalise(schedule.orderSql)).toContain("t.created_at ASC");
    });
});
