import { buildTaskCollection } from "../modules/tasks/tasks.collection";
import type { TaskVisibility } from "../modules/tasks/tasks.policy";

const visibility: TaskVisibility = { kind: "projects", projectIds: [10, 11], userId: 7 };

describe("project-owned task collections", () => {
    test("backlog uses sprint placement and project visibility, not removed team/day columns", () => {
        const query = buildTaskCollection({
            scope: "backlog", orgId: 3, visibility,
        });
        expect(query.whereSql).toContain("t.sprint_id IS NULL");
        expect(query.whereSql).toContain("t.project_id = ANY($2::int[])");
        expect(query.whereSql).not.toMatch(/team_id|planned_date/);
        expect(query.params).toEqual([3, [10, 11], 7]);
    });

    test("daily work is selected by start date", () => {
        const query = buildTaskCollection({
            scope: "daily", orgId: 3, visibility, date: "2026-11-12",
        });
        expect(query.whereSql).toContain("t.start_date = $1");
        expect(query.whereSql).not.toMatch(/team_id|planned_date/);
        expect(query.params).toEqual(["2026-11-12", 3, [10, 11], 7]);
    });

    test("calendar ranges include overlapping tasks and undated work", () => {
        const range = buildTaskCollection({
            scope: "calendar", orgId: 3, visibility,
            startDate: "2026-11-01", endDate: "2026-11-30",
        });
        expect(range.whereSql).toContain("COALESCE(t.start_date, t.due_date) <= $1");
        expect(range.whereSql).toContain("COALESCE(t.due_date, t.start_date) >= $2");

        const undated = buildTaskCollection({
            scope: "calendar", orgId: 3, visibility, undated: true,
        });
        expect(undated.whereSql).toContain("t.start_date IS NULL");
        expect(undated.whereSql).toContain("t.due_date IS NULL");
    });

    test("list scope can be narrowed to one project", () => {
        const query = buildTaskCollection({
            scope: "list", orgId: 3, visibility, filters: { projectId: "11" },
        });
        expect(query.whereSql).toContain("t.project_id = $4");
        expect(query.params).toEqual([3, [10, 11], 7, 11]);
    });
});
