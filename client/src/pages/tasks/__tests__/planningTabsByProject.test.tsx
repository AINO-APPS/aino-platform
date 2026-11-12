import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import PlanningTabs from "../PlanningTabs";

describe("server-decided project planning tabs", () => {
    test.each([
        ["Scrum", ["backlog", "sprint", "reports"], ["Backlog", "Sprint", "Reports"]],
        ["Kanban", ["board"], ["Board"]],
        ["Task list", ["list", "board", "calendar"], ["List", "Board", "Calendar"]],
    ])("%s renders the server order even without agile or a current sprint", (_name, planTabs, labels) => {
        render(<PlanningTabs activeTab={planTabs[0]} setActiveTab={vi.fn()} agileEnabled={false}
            backlogCount={0} currentSprintId={null} setSelectedSprintId={vi.fn()} planTabs={planTabs as any} />);
        expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(labels);
    });
    test("Scrum Sprint never swaps for Scheduled as a sprint starts or ends", () => {
        const onSprint = vi.fn();
        const props = { activeTab: "backlog", setActiveTab: vi.fn(), agileEnabled: false,
            backlogCount: 0, setSelectedSprintId: onSprint, planTabs: ["backlog", "sprint", "reports"] as any };
        const { rerender } = render(<PlanningTabs {...props} currentSprintId={null} />);
        fireEvent.click(screen.getByRole("tab", { name: "Sprint" }));
        expect(onSprint).toHaveBeenCalledWith(null);
        rerender(<PlanningTabs {...props} currentSprintId={7} />);
        expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Backlog", "Sprint", "Reports"]);
        rerender(<PlanningTabs {...props} currentSprintId={null} />);
        expect(screen.queryByRole("tab", { name: "Scheduled" })).toBeNull();
        expect(screen.getByRole("tab", { name: "Sprint" })).toBeTruthy();
    });
});
