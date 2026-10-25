import { describe, expect, test } from "vitest";
import {
    parseTasksRoute,
    readUrlFilters,
    tasksViewPath,
    writeUrlFilters,
} from "../hooks/useTasksRoute";

const params = (query: string) => new URLSearchParams(query);

describe("tasks routes", () => {
    test("each view has its own path", () => {
        expect(tasksViewPath("backlog")).toBe("/tasks/backlog");
        expect(tasksViewPath("scheduled")).toBe("/tasks/schedule");
        expect(tasksViewPath("service-desk")).toBe("/tasks/desk");
        expect(tasksViewPath("sprint", 12)).toBe("/tasks/sprint/12");
        expect(tasksViewPath("sprint", 12, true)).toBe("/tasks/sprint/12/plan");
    });

    test("parses the view and sprint from the path", () => {
        expect(parseTasksRoute("/tasks/backlog", params(""))).toEqual({
            view: "backlog", sprintId: null, plan: false,
        });
        expect(parseTasksRoute("/tasks/sprint/12", params(""))).toEqual({
            view: "sprint", sprintId: "12", plan: false,
        });
        expect(parseTasksRoute("/tasks/sprint/12/plan", params(""))).toEqual({
            view: "sprint", sprintId: "12", plan: true,
        });
        expect(parseTasksRoute("/tasks/schedule", params(""))).toEqual({
            view: "scheduled", sprintId: null, plan: false,
        });
    });

    test("an unknown or stale path degrades to the backlog", () => {
        expect(parseTasksRoute("/tasks/archived", params("")).view).toBe("backlog");
        expect(parseTasksRoute("/tasks", params("")).view).toBe("backlog");
        expect(parseTasksRoute("/tasks/sprint", params("")).view).toBe("sprint");
    });

    test("filters round-trip through the query string", () => {
        const filters = {
            assignee: "me",
            label: "7",
            priority: "high",
            status: "in_progress",
            search: "refund",
            project: "3",
            epic: "9",
            type: "2",
            completed: "1",
        };
        const written = writeUrlFilters(params(""), filters);
        expect(readUrlFilters(written)).toEqual(filters);
    });

    test("empty filters are dropped so URLs stay short", () => {
        const written = writeUrlFilters(params("assignee=me&priority=high"), {
            assignee: "",
            priority: "low",
        });
        expect(written.toString()).toBe("priority=low");
    });

    test("unrecognised parameters are ignored rather than erroring", () => {
        const filters = readUrlFilters(params("assignee=me&nonsense=1&priority=urgent"));
        expect(filters.assignee).toBe("me");
        expect(filters.priority).toBe("urgent");
        expect(Object.keys(filters)).not.toContain("nonsense");
    });

    test("a shared URL reproduces the identical view", () => {
        const shared = "/tasks/sprint/12/plan?assignee=me&priority=high&completed=1";
        const [pathname, query] = shared.split("?");
        const route = parseTasksRoute(pathname, params(query));
        const filters = readUrlFilters(params(query));

        expect(route).toEqual({ view: "sprint", sprintId: "12", plan: true });
        expect(filters.assignee).toBe("me");
        expect(filters.priority).toBe("high");
        expect(filters.completed).toBe("1");
    });
});
