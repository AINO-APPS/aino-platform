/**
 * Landing on Tasks follows the selected team's sprint state.
 *
 * An active sprint means the board is where the work is, so the bare `/tasks`
 * entry opens the sprint Board — not the Plan split view, which is only an
 * explicit "Plan sprint" action. With no active sprint the team lands on the
 * Backlog and Scheduled holds dated work.
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

describe("tabs follow the selected team's sprint state", () => {
    const active = { id: 12, status: "active", team_id: 3 };
    const planned = { id: 13, status: "planned", team_id: 3 };

    test("an active sprint shows Sprint, Backlog and Scheduled", () => {
        expect(planningTabs({ agileEnabled: true, sprints: [active, planned] })).toEqual({
            tabs: ["sprint", "backlog", "scheduled", "service-desk"],
            activeSprintId: 12,
        });
    });

    test("no active sprint hides Sprint; Backlog and Scheduled remain", () => {
        expect(planningTabs({ agileEnabled: true, sprints: [planned] })).toEqual({
            tabs: ["backlog", "scheduled", "service-desk"],
            activeSprintId: null,
        });
    });

    test("agile off never offers Sprint", () => {
        expect(planningTabs({ agileEnabled: false, sprints: [active] }).tabs).not.toContain("sprint");
    });
});
