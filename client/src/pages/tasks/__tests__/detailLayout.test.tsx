/**
 * The fullscreen task layout.
 *
 * The redesign moved the title out of the header (it was truncated there and
 * repeated in the body) and split the view into a content column plus a
 * properties column. These tests assert the structure that makes that work, so
 * a later edit cannot quietly put the title back in the header or drop the
 * properties aside.
 */
import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TaskDetailSheet from "../TaskDetailSheet";
import TaskDetailView from "../TaskDetailView";
import { ToastProvider } from "../../../components/common/Toast";

const task = {
    id: 7,
    title: "Refund webhook retries",
    issue_key: "PAY-142",
    priority: "high",
    story_points: 5,
    workflow_state_key: "in_progress",
    assignee: { id: 2, full_name: "Ada Lovelace", username: "ada" },
    labels: [{ id: 1, name: "payments", color: "#22c55e" }],
    description: "<p>Retries must be idempotent.</p>",
    planned_date: "2026-10-25",
    due_date: "2026-11-01",
    created_at: "2026-10-20T09:00:00Z",
};

function renderView() {
    return render(
        <MemoryRouter>
            <ToastProvider>
                <TaskDetailView
                    task={task}
                    availableSprints={[]}
                    customFields={[]}
                    customValues={{}}
                    currentUser={{ id: 2, role: "employee" }}
                    onStatusChange={vi.fn()}
                    activity={<p>Discussion</p>}
                />
            </ToastProvider>
        </MemoryRouter>,
    );
}

describe("fullscreen task layout", () => {
    test("the title appears once, in the content", () => {
        renderView();
        expect(screen.getAllByText("Refund webhook retries")).toHaveLength(1);
    });

    test("the properties sit in their own labelled column", () => {
        renderView();
        const properties = screen.getByRole("complementary", { name: "Task properties" });
        expect(properties).toBeTruthy();
        expect(properties.textContent).toContain("Planned date");
        expect(properties.textContent).toContain("Due date");
    });

    test("planned and due dates stay distinct", () => {
        renderView();
        expect(screen.getByText("Planned date")).toBeTruthy();
        expect(screen.getByText("Due date")).toBeTruthy();
    });

    test("discussion renders under the content", () => {
        renderView();
        expect(screen.getByText("Discussion")).toBeTruthy();
    });

    test("the sheet header does not repeat the full title", () => {
        render(
            <TaskDetailSheet
                open
                title="Refund webhook retries"
                onClose={vi.fn()}
                badges={<span>PAY-142</span>}
            >
                <p>Body</p>
            </TaskDetailSheet>,
        );
        const dialog = screen.getByRole("dialog", { name: "Refund webhook retries" });
        expect(dialog.textContent).not.toContain("Refund webhook retries");
        expect(screen.getByText("PAY-142")).toBeTruthy();
    });
});
