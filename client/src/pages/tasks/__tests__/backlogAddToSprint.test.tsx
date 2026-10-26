/**
 * The backlog offers "Add to sprint".
 *
 * The backlog is the only place a ticket can be planned, so the action has to
 * live on the backlog card. It was missing entirely: the only way to plan a
 * ticket was to switch to the Sprint tab and use the split planner.
 */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BacklogCard from "../BacklogCard";
import { TaskProvider } from "../TaskContext";
import { ToastProvider } from "../../../components/common/Toast";

const task = {
    id: 7,
    title: "Refund webhook retries",
    issue_key: "PAY-142",
    priority: "high",
    workflow_state_key: "pending",
    due_date: "2099-11-01",
};

function renderCard(onAddToSprint?: (task: any) => void) {
    return render(
        <MemoryRouter>
            <ToastProvider>
                <TaskProvider
                    assignableUsers={[]}
                    orgLabels={[]}
                    availableSprints={[{ id: 1, name: "Sprint #1", status: "active" }] as any}
                    availableProjects={[]}
                    currentUser={null}
                    activeTab="backlog"
                >
                    <BacklogCard
                        task={task}
                        workflowStates={[]}
                        scheduleTaskId={null}
                        scheduleDate=""
                        setScheduleTaskId={vi.fn()}
                        setScheduleDate={vi.fn()}
                        onOpenDetail={vi.fn()}
                        onScheduleTask={vi.fn()}
                        onAddToSprint={onAddToSprint}
                    />
                </TaskProvider>
            </ToastProvider>
        </MemoryRouter>,
    );
}

describe("backlog card actions", () => {
    test("offers Add to sprint when sprints exist", () => {
        const onAddToSprint = vi.fn();
        renderCard(onAddToSprint);

        fireEvent.click(screen.getByRole("button", { name: /Actions for PAY-142/i }));
        fireEvent.click(screen.getByRole("menuitem", { name: "Add to sprint" }));

        expect(onAddToSprint).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
    });

    test("hides Add to sprint when the tenant has no sprints", () => {
        renderCard(undefined);

        fireEvent.click(screen.getByRole("button", { name: /Actions for PAY-142/i }));

        expect(screen.queryByRole("menuitem", { name: "Add to sprint" })).toBeNull();
    });
});
