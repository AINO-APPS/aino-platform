/**
 * The Plan card redesign.
 *
 * Compact is the default and keeps three lines: a quiet key/priority line, the
 * title, and a footer with the status pill, due date, at most two labels and
 * the assignee avatar. Comfortable adds the description preview and comment
 * count. Backlog and board share the same anatomy; the backlog adds the
 * org-themed "Schedule to a day" action.
 */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BacklogCard from "../BacklogCard";
import TaskCard from "../TaskCard";
import { TaskProvider, useCardDensity } from "../TaskContext";
import { ToastProvider } from "../../../components/common/Toast";
import fs from "node:fs";
import path from "node:path";

const task = {
    id: 7,
    title: "Refund webhook retries",
    issue_key: "PAY-142",
    priority: "high",
    story_points: 5,
    workflow_state_key: "in_progress",
    assignee: { id: 2, full_name: "Ada Lovelace", username: "ada" },
    labels: [
        { id: 1, name: "payments", color: "#22c55e" },
        { id: 2, name: "billing", color: "#3b82f6" },
        { id: 3, name: "urgent", color: "#ef4444" },
    ],
    description: "<p>Retry failed refund webhooks with backoff.</p>",
    comment_count: 4,
    due_date: "2099-11-01",
};

function wrap(node: React.ReactNode, density?: "comfortable" | "compact") {
    return render(
        <MemoryRouter>
            <ToastProvider>
                <TaskProvider
                    assignableUsers={[]}
                    orgLabels={[]}
                    availableSprints={[]}
                    availableProjects={[]}
                    currentUser={null}
                    activeTab="backlog"
                    cardDensity={density}
                >
                    {node}
                </TaskProvider>
            </ToastProvider>
        </MemoryRouter>,
    );
}

const board = (t: any = task) => (
    <TaskCard
        task={t}
        onOpenDetail={vi.fn()}
        onOpenComments={vi.fn()}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
    />
);

const backlog = (props: Partial<React.ComponentProps<typeof BacklogCard>> = {}) => (
    <BacklogCard
        task={task}
        workflowStates={[]}
        scheduleTaskId={null}
        scheduleDate=""
        setScheduleTaskId={vi.fn()}
        setScheduleDate={vi.fn()}
        onOpenDetail={vi.fn()}
        onScheduleTask={vi.fn()}
        {...props}
    />
);

describe("density default", () => {
    test("cards are compact when no density is chosen", () => {
        let seen = "";
        function Probe() {
            seen = useCardDensity();
            return null;
        }
        wrap(<Probe />);
        expect(seen).toBe("compact");
    });
});

describe.each([
    ["board card", () => board()],
    ["backlog row", () => backlog()],
])("compact %s", (_name, make) => {
    test("shows key, title, status, due, two labels and the assignee avatar", () => {
        wrap(make(), "compact");
        expect(screen.getByText("PAY-142")).toBeTruthy();
        expect(screen.getByText("Refund webhook retries")).toBeTruthy();
        expect(screen.getByText("In Progress")).toBeTruthy();
        expect(screen.getByText("payments")).toBeTruthy();
        expect(screen.getByText("billing")).toBeTruthy();
        expect(screen.queryByText("urgent")).toBeNull();
        expect(screen.getByRole("button", { name: "Show all 3 labels" })).toBeTruthy();
        expect(screen.getByLabelText("Assigned to Ada Lovelace")).toBeTruthy();
        expect(screen.getByLabelText("High priority")).toBeTruthy();
    });

    test("does not preview the description", () => {
        wrap(make(), "compact");
        expect(screen.queryByText(/Retry failed refund/)).toBeNull();
    });
});

describe("comfortable density", () => {
    test("adds the description preview", () => {
        wrap(board(), "comfortable");
        expect(screen.getByText(/Retry failed refund/)).toBeTruthy();
    });
});

describe("schedule to a day", () => {
    test("the backlog row shows an org-themed Schedule action", () => {
        wrap(backlog(), "compact");
        const button = screen.getByRole("button", { name: "Schedule to a day" });
        expect(button.className).toContain("schedule-btn");
    });

    test("the popover offers quick picks and confirms with Schedule", () => {
        const setScheduleDate = vi.fn();
        const onScheduleTask = vi.fn();
        wrap(
            backlog({ scheduleTaskId: 7, scheduleDate: "2026-10-26", setScheduleDate, onScheduleTask }),
            "compact",
        );
        fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
        expect(setScheduleDate).toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
        expect(onScheduleTask).toHaveBeenCalledWith(7, "Refund webhook retries");
    });

    test("the schedule button is painted with the org primary, not a fixed colour", () => {
        const css = fs.readFileSync(path.join(__dirname, "..", "TaskCard.module.css"), "utf8");
        const rule = css.match(/\.schedule-btn\s*\{([^}]*)\}/)?.[1] ?? "";
        expect(rule).toMatch(/var\(--primary\)/);
        expect(rule).not.toMatch(/#[0-9a-f]{3,6}/i);
    });
});
