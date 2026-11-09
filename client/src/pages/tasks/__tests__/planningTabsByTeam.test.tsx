/** The legacy team tab row is stable while sprint availability changes. */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import PlanningTabs from "../PlanningTabs";

function renderTabs(
    currentSprintId: number | null,
    agile = true,
    onTab = vi.fn(),
    onSprint = vi.fn(),
) {
    render(
        <PlanningTabs
            activeTab="backlog"
            setActiveTab={onTab}
            agileEnabled={agile}
            backlogCount={0}
            currentSprintId={currentSprintId}
            setSelectedSprintId={onSprint}
        />,
    );
    return { onTab, onSprint };
}

describe("legacy team planning tabs", () => {
    test("an active sprint offers Sprint, Backlog and Service Desk — never Scheduled", () => {
        renderTabs(7);
        for (const name of [/^Sprint$/, /Backlog/, /Service Desk/]) {
            expect(screen.getByRole("tab", { name })).toBeTruthy();
        }
        expect(screen.queryByRole("tab", { name: /Scheduled/ })).toBeNull();
    });

    test("Sprint remains available even when there is no current sprint", () => {
        renderTabs(null);
        expect(screen.getByRole("tab", { name: /^Sprint$/ })).toBeTruthy();
        expect(screen.getByRole("tab", { name: /Backlog/ })).toBeTruthy();
        expect(screen.getByRole("tab", { name: /Service Desk/ })).toBeTruthy();
        expect(screen.queryByRole("tab", { name: /Scheduled/ })).toBeNull();
    });

    test("agile off hides Sprint even with an active sprint", () => {
        renderTabs(7, false);
        expect(screen.queryByRole("tab", { name: /^Sprint$/ })).toBeNull();
    });

    test("choosing Sprint opens the active sprint, not a planned one", () => {
        const { onTab, onSprint } = renderTabs(7);
        fireEvent.click(screen.getByRole("tab", { name: /^Sprint$/ }));
        expect(onSprint).toHaveBeenCalledWith(7);
        expect(onTab).toHaveBeenCalledWith("sprint");
    });

    test("a paused current sprint offers Sprint and remains the selected board", () => {
        const { onSprint } = renderTabs(19);
        fireEvent.click(screen.getByRole("tab", { name: /^Sprint$/ }));
        expect(onSprint).toHaveBeenCalledWith(19);
    });
});
