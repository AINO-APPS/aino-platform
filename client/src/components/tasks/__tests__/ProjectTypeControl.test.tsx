import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ProjectTypeControl } from "../ProjectTypeControl";

test("creation offers only server-approved types with descriptions", () => {
    render(<ProjectTypeControl value="task_list" availableTypes={["task_list"]} onChange={vi.fn()} />);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Task list"]);
    expect(screen.getByText(/Plain ticketing with list, board and calendar views/)).toBeTruthy();
});
test("settings keep the existing Scrum type visible after feature loss and explain refusal", () => {
    const change = vi.fn();
    render(<ProjectTypeControl value="scrum" availableTypes={["task_list"]} changeableTypes={[]}
        canChangeType={true} onChange={change} error="Complete or remove every planned, active or paused sprint before leaving Scrum." />);
    expect(screen.getByRole("option", { name: "Scrum" })).toBeTruthy();
    expect((screen.getByRole("option", { name: "Task list" }) as HTMLOptionElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/planned, active or paused sprint/);
});
test("members see type read-only and admins can select allowed destinations", () => {
    const change = vi.fn();
    const { rerender } = render(<ProjectTypeControl value="kanban" availableTypes={["scrum", "kanban", "task_list"]}
        canChangeType={false} onChange={change} />);
    expect((screen.getByRole("combobox", { name: "Project type" }) as HTMLSelectElement).disabled).toBe(true);
    rerender(<ProjectTypeControl value="kanban" availableTypes={["scrum", "kanban", "task_list"]}
        changeableTypes={["scrum", "kanban", "task_list"]} canChangeType={true} onChange={change} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "scrum" } });
    expect(change).toHaveBeenCalledWith("scrum");
});
