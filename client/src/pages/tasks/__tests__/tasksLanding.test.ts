/**
 * Landing on Tasks opens the sprint that is actually running.
 *
 * Once a team's sprint is started, the sprint plan is where the work is: the
 * backlog is only the pool of unplanned tickets. Landing on the backlog every
 * time made the user click through to the sprint they were already in.
 *
 * The rule is narrow on purpose — it only applies to the bare `/tasks` entry
 * point. An explicit `/tasks/backlog` (a bookmark, a shared link, a tab the
 * user chose) is always honoured.
 */
import { describe, expect, test } from "vitest";
import { landingTasksPath, parseTasksRoute } from "../hooks/useTasksRoute";

const params = (query = "") => new URLSearchParams(query);

describe("Tasks landing view", () => {
    test("an active sprint makes the sprint plan the landing view", () => {
        expect(landingTasksPath("/tasks", 12)).toBe("/tasks/sprint/12/plan");
    });

    test("no active sprint keeps the backlog", () => {
        expect(landingTasksPath("/tasks", null)).toBe("/tasks/backlog");
    });

    test("an explicit view is never overridden", () => {
        expect(landingTasksPath("/tasks/backlog", 12)).toBe("/tasks/backlog");
        expect(landingTasksPath("/tasks/schedule", 12)).toBe("/tasks/schedule");
        expect(landingTasksPath("/tasks/desk", 12)).toBe("/tasks/desk");
        expect(landingTasksPath("/tasks/sprint/9", 12)).toBe("/tasks/sprint/9");
        expect(landingTasksPath("/tasks/sprint/9/plan", 12)).toBe("/tasks/sprint/9/plan");
    });

    test("the landing path parses back to the sprint plan", () => {
        const path = landingTasksPath("/tasks", 12);
        expect(parseTasksRoute(path, params())).toEqual({
            view: "sprint",
            sprintId: "12",
            plan: true,
        });
    });
});
