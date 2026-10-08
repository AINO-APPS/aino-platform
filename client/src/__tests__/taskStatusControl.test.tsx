import { fireEvent, render, screen } from "@testing-library/react";
import { describe, test, expect, vi } from "vitest";

let mockStates: any[] = [];
vi.mock("../AgileConfigContext", () => ({ useAgileConfig: () => ({ workflowStates: mockStates }) }));

import TaskStatusControl from "../pages/tasks/TaskStatusControl";
import { canChangeTaskStatus, currentStatusOption, statusOptions } from "../pages/tasks/taskStatus";

const backlogTicket = { id: 5, title: "Fix login", status: "pending", user_id: 1, assigned_to: 2, sprint_id: null, date: null };

describe("canChangeTaskStatus", () => {
    test("assignee, reporter and org admins may change status; others may not", () => {
        expect(canChangeTaskStatus(backlogTicket, 1, "employee")).toBe(true);
        expect(canChangeTaskStatus(backlogTicket, 2, "employee")).toBe(true);
        expect(canChangeTaskStatus(backlogTicket, 9, "hr_admin")).toBe(true);
        expect(canChangeTaskStatus(backlogTicket, 9, "team_lead")).toBe(false);
        expect(canChangeTaskStatus(null, 1, "super_admin")).toBe(false);
    });
});

describe("status options", () => {
    test("falls back to the default columns without agile config", () => {
        expect(statusOptions([]).map((o) => o.key)).toEqual(["pending", "in_progress", "in_review", "done"]);
    });

    test("uses the org's workflow states and resolves the current one by id first", () => {
        const states = [
            { id: 11, key: "todo", name: "To do", color: "#999" },
            { id: 12, key: "qa", name: "QA", color: "#0af" },
        ];
        const opts = statusOptions(states);
        expect(opts.map((o) => o.label)).toEqual(["To do", "QA"]);
        expect(currentStatusOption({ status: "todo", workflow_state_id: 12 }, states, opts)?.key).toBe("qa");
    });
});

describe("TaskStatusControl", () => {
    test("is shown for a backlog ticket (no sprint) and moves it", () => {
        mockStates = [];
        const onChange = vi.fn();
        render(<TaskStatusControl task={backlogTicket} currentUser={{ id: 2, role: "employee" }} onChange={onChange} />);

        expect(screen.getByTestId("task-status-control")).toBeTruthy();
        expect((screen.getByRole("button", { name: /New/ }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole("button", { name: /In Progress/ }));
        expect(onChange).toHaveBeenCalledWith(backlogTicket, { id: "in_progress", label: "In Progress" });
    });

    test("is read-only for someone who is neither assignee nor reporter", () => {
        mockStates = [];
        const onChange = vi.fn();
        render(<TaskStatusControl task={backlogTicket} currentUser={{ id: 9, role: "employee" }} onChange={onChange} />);

        const button = screen.getByRole("button", { name: /Done/ }) as HTMLButtonElement;
        expect(button.disabled).toBe(true);
        fireEvent.click(button);
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByTestId("task-status-control").getAttribute("title")).toMatch(/assignee or reporter/);
    });
});
