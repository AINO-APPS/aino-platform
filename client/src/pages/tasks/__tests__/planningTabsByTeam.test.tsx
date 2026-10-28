/**
 * The tab row follows the selected team's sprint state.
 *
 * A started sprint leads with the Sprint board; Backlog and Scheduled sit beside
 * it. No active sprint hides Sprint — a planned sprint alone is not a board.
 * Service Desk belongs to every team.
 */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import PlanningTabs from "../PlanningTabs";

function renderTabs(sprints: any[], agile = true, onTab = vi.fn(), onSprint = vi.fn()) {
    render(
        <PlanningTabs
            activeTab="backlog"
            setActiveTab={onTab}
            agileEnabled={agile}
            backlogCount={0}
            availableSprints={sprints}
            setSelectedSprintId={onSprint}
        />,
    );
    return { onTab, onSprint };
}

describe("planning tabs follow the team's sprint state", () => {
    test("an active sprint offers Sprint, Backlog, Scheduled and Service Desk", () => {
        renderTabs([{ id: 7, status: "active" }]);
        for (const name of [/Sprint/, /Backlog/, /Scheduled/, /Service Desk/]) {
            expect(screen.getByRole("tab", { name })).toBeTruthy();
        }
    });

    test("only a planned sprint hides the Sprint tab", () => {
        renderTabs([{ id: 8, status: "planned" }]);
        expect(screen.queryByRole("tab", { name: /^Sprint$/ })).toBeNull();
        expect(screen.getByRole("tab", { name: /Backlog/ })).toBeTruthy();
        expect(screen.getByRole("tab", { name: /Scheduled/ })).toBeTruthy();
    });

    test("agile off hides Sprint even with an active sprint", () => {
        renderTabs([{ id: 7, status: "active" }], false);
        expect(screen.queryByRole("tab", { name: /^Sprint$/ })).toBeNull();
    });

    test("choosing Sprint opens the active sprint, not a planned one", () => {
        const { onTab, onSprint } = renderTabs([
            { id: 8, status: "planned" },
            { id: 7, status: "active" },
        ]);
        fireEvent.click(screen.getByRole("tab", { name: /^Sprint$/ }));
        expect(onSprint).toHaveBeenCalledWith(7);
        expect(onTab).toHaveBeenCalledWith("sprint");
    });
});
