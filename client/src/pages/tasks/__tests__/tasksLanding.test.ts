/**
 * Legacy landing paths keep working; project planning tabs come from the server.
 *
 * An active sprint means the board is where the work is, so the bare `/tasks`
 * entry opens the sprint Board — not the Plan split view, which is only an
 * explicit "Plan sprint" action. With no active sprint the team lands on the
 * Backlog. Dates never create a separate planning container.
 *
 * Explicit views (a bookmark, a shared link, a chosen tab) are honoured.
 */
import { describe, expect, test } from "vitest";
import { landingTasksPath, parseTasksRoute } from "../hooks/useTasksRoute";
import { planningTabs } from "../hooks/usePlanningSurface";

const params = (query = "") => new URLSearchParams(query);

describe("Tasks landing view", () => {
    test("an active sprint makes the sprint board the landing view", () => {
        expect(landingTasksPath("/tasks", 12)).toBe("/tasks/sprint/12");
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

    test("the landing path parses back to the sprint board", () => {
        expect(parseTasksRoute(landingTasksPath("/tasks", 12), params())).toEqual({
            view: "sprint",
            sprintId: "12",
            plan: false,
        });
    });
});

describe("planning tabs stay stable and follow the server's project response", () => {
    const active = { id: 12, status: "active", team_id: 3 };
    test("an active sprint shows Sprint and Backlog, and no Scheduled", () => {
        expect(planningTabs({ agileEnabled: true, currentSprintId: active.id })).toEqual({
            tabs: ["sprint", "backlog", "service-desk"],
            currentSprintId: 12,
        });
    });

    test("no active sprint keeps Sprint and Backlog, without Scheduled", () => {
        expect(planningTabs({ agileEnabled: true, currentSprintId: null })).toEqual({
            tabs: ["sprint", "backlog", "service-desk"],
            currentSprintId: null,
        });
    });

    test.each([
        ["backlog", "sprint", "reports"],
        ["board"],
        ["board", "backlog"],
        ["list", "board", "calendar"],
    ] as const)("server tabs %j survive feature loss and an absent sprint", (...tabs) => {
        expect(planningTabs({ agileEnabled: false, currentSprintId: null, planTabs: [...tabs] })).toEqual({
            tabs,
            currentSprintId: null,
        });
    });

    test("agile off never offers Sprint", () => {
        expect(planningTabs({ agileEnabled: false, currentSprintId: active.id }).tabs).not.toContain("sprint");
    });

    test("a paused current sprint is the sprint landing target", () => {
        const pausedCurrentSprintId = 19;
        expect(planningTabs({ agileEnabled: true, currentSprintId: pausedCurrentSprintId })).toEqual({
            tabs: ["sprint", "backlog", "service-desk"],
            currentSprintId: pausedCurrentSprintId,
        });
        expect(landingTasksPath("/tasks", pausedCurrentSprintId)).toBe("/tasks/sprint/19");
    });
});
