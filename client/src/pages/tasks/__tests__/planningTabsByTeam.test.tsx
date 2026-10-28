/**
 * Sprint and Schedule are alternative planning surfaces, never companions.
 *
 * A team that has sprint config plans work in the sprint, so the dated Schedule
 * view is not offered beside it. A team with no sprint config has no sprint to
 * put work in, so its dated view is the only place a due date means anything.
 * Backlog and Service Desk belong to both.
 *
 * The gate is the team's sprint config (`team_sprint_enabled`), not the sprint
 * list: `GET /tasks/available-sprints` materialises sprint rows as a side effect
 * of being read, so gating on the list made the tab set flicker.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { isSprintEnabled } from "../hooks/usePlanningSurface";

let AGILE = true;
vi.mock("../../../FeaturesContext", () => ({
    useFeatures: () => ({ hasFeature: () => AGILE }),
}));

const PlanningTabs = (await import("../PlanningTabs")).default;

function renderTabs(user: any, sprints: any[] = [], agile = true) {
    AGILE = agile;
    return render(
        <PlanningTabs
            activeTab="backlog"
            setActiveTab={() => {}}
            currentUser={user}
            agileEnabled={agile}
            backlogCount={0}
            availableSprints={sprints}
            selectedSprintId={null}
            setSelectedSprintId={() => {}}
        />,
    );
}

describe("planning tabs follow the team's sprint config", () => {
    beforeEach(() => {
        AGILE = true;
    });

    test("a sprint team is offered Sprint, not Scheduled", () => {
        renderTabs({ id: 1, team_id: 1, team_sprint_enabled: true });
        expect(screen.getByRole("button", { name: /Sprint/ })).toBeTruthy();
        expect(screen.queryByRole("button", { name: /Scheduled/ })).toBeNull();
        // The backlog is common to both surfaces.
        expect(screen.getByRole("button", { name: /Backlog/ })).toBeTruthy();
    });

    test("a team with no sprint config is offered Scheduled, not Sprint", () => {
        renderTabs({ id: 1, team_id: 1, team_sprint_enabled: false });
        expect(screen.getByRole("button", { name: /Scheduled/ })).toBeTruthy();
        expect(screen.queryByRole("button", { name: /Sprint/ })).toBeNull();
        expect(screen.getByRole("button", { name: /Backlog/ })).toBeTruthy();
    });

    test("the Sprint tab does not wait for a sprint row to exist", () => {
        // No sprints in context: the team's config alone is enough.
        renderTabs({ team_sprint_enabled: true }, []);
        expect(screen.getByRole("button", { name: /Sprint/ })).toBeTruthy();
    });

    test("an older server that omits the flag keeps the Sprint tab", () => {
        // `undefined` is "not reported", which must not read as "no sprints".
        renderTabs({ id: 1 }, [{ id: 7, status: "active" }]);
        expect(screen.getByRole("button", { name: /Sprint/ })).toBeTruthy();
    });

    test("an older server with no sprints still shows the dated surface", () => {
        renderTabs({ id: 1 }, []);
        expect(screen.queryByRole("button", { name: /Sprint/ })).toBeNull();
        expect(screen.getByRole("button", { name: /Scheduled/ })).toBeTruthy();
    });

    test("agile off loses the Sprint tab whatever the team config says", () => {
        renderTabs({ team_sprint_enabled: true }, [], false);
        expect(screen.queryByRole("button", { name: /Sprint/ })).toBeNull();
        expect(screen.getByRole("button", { name: /Scheduled/ })).toBeTruthy();
    });

    test("the predicate distinguishes unknown from no-sprints", () => {
        expect(isSprintEnabled({}, true, [])).toBe(false);
        expect(isSprintEnabled({ team_sprint_enabled: false }, true, [{ id: 1 }])).toBe(false);
        expect(isSprintEnabled({ team_sprint_enabled: true }, true, [])).toBe(true);
        expect(isSprintEnabled({ team_sprint_enabled: true }, false, [])).toBe(false);
    });
});
