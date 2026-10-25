/**
 * WCAG 2.1 AA audit for every Tasks surface.
 *
 * The four surfaces the design spec names as release gates — Backlog, Board,
 * Plan and Schedule — are rendered and run through axe, plus the overlays that
 * sit on top of them. A violation fails the build, so accessibility is enforced
 * rather than promised.
 *
 * jsdom has no layout engine, so `color-contrast` and `target-size` cannot be
 * evaluated here; `contrast.test.ts` asserts the token pairs directly instead.
 */
import { describe, expect, test, vi } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BacklogCard from "../../BacklogCard";
import TaskCard from "../../TaskCard";
import KanbanBoard from "../../KanbanBoard";
import SprintPlan from "../../SprintPlan";
import ScheduleCalendar from "../../ScheduleCalendar";
import CompletedSection from "../../CompletedSection";
import BulkActionBar from "../../BulkActionBar";
import CommandPalette from "../../CommandPalette";
import ShortcutHelp from "../../ShortcutHelp";
import TaskDetailSheet from "../../TaskDetailSheet";
import { TaskProvider } from "../../TaskContext";
import { ToastProvider } from "../../../../components/common/Toast";
import { buildPaletteItems, paletteViews } from "../../hooks/useCommandPalette";
import { useUndoToast } from "../../hooks/useUndoToast";
import { expectAccessible, LAYOUT_DEPENDENT_RULES } from "./axe";

const task = {
    id: 7,
    title: "Refund webhook retries",
    issue_key: "PAY-142",
    priority: "high",
    story_points: 5,
    workflow_state_id: 2,
    workflow_state_key: "in_progress",
    workflow_state_category: "in_progress",
    assignee: { id: 2, full_name: "Ada Lovelace", username: "ada" },
    labels: [{ id: 1, name: "payments", color: "#22c55e" }],
    description: "<p>A long description.</p>",
    planned_date: "2026-10-25",
    due_date: "2026-11-01",
    created_at: "2026-10-20T09:00:00Z",
};

const columns = [
    { id: 1, key: "pending", name: "New", category: "open", color: "#6b7280" },
    { id: 2, key: "in_progress", name: "In Progress", category: "in_progress", color: "#f59e0b" },
    { id: 3, key: "done", name: "Done", category: "done", color: "#10b981", is_terminal: true },
];

function wrap(node: React.ReactNode) {
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
                    cardDensity="comfortable"
                >
                    {node}
                </TaskProvider>
            </ToastProvider>
        </MemoryRouter>,
    );
}

const audit = (container: HTMLElement) =>
    expectAccessible(container, { disableRules: LAYOUT_DEPENDENT_RULES });

describe("Tasks surfaces are WCAG 2.1 AA clean", () => {
    test("backlog card", async () => {
        const { container } = wrap(
            <BacklogCard
                task={task}
                workflowStates={columns}
                scheduleTaskId={null}
                scheduleDate=""
                setScheduleTaskId={vi.fn()}
                setScheduleDate={vi.fn()}
                onOpenDetail={vi.fn()}
                onScheduleTask={vi.fn()}
            />,
        );
        await audit(container);
    });

    test("board card", async () => {
        const { container } = wrap(
            <TaskCard
                task={task}
                onOpenDetail={vi.fn()}
                onOpenComments={vi.fn()}
                onDragStart={vi.fn()}
                onDragEnd={vi.fn()}
            />,
        );
        await audit(container);
    });

    test("board", async () => {
        const { container } = wrap(
            <KanbanBoard
                tasks={[task]}
                dragOverCol={null}
                onDragOver={vi.fn()}
                onDragLeave={vi.fn()}
                onDrop={vi.fn()}
                onDragStart={vi.fn()}
                onDragEnd={vi.fn()}
                onOpenDetail={vi.fn()}
                onOpenComments={vi.fn()}
                announcement="Moved Refund webhook retries to In Progress"
            />,
        );
        await audit(container);
    });

    test("sprint plan", async () => {
        const { container } = wrap(
            <SprintPlan
                backlogTasks={[{ id: 1, issue_key: "PAY-1", title: "Refund webhook", story_points: 5 }]}
                sprintTasks={[{ id: 3, issue_key: "PAY-3", title: "Retry backoff", story_points: 8 }]}
                sprint={{ id: 9, name: "Sprint 24", goal: "Refunds never double", velocity_points: 20 }}
                velocity={{ sprints: [], average: 18 }}
                burndown={[{ snapshot_date: "2026-10-01", remaining_points: 20 }]}
                unitLabel="SP"
                onMoveToSprint={vi.fn()}
                onMoveToBacklog={vi.fn()}
                onSaveGoal={vi.fn()}
                onOpenDetail={vi.fn()}
            />,
        );
        await audit(container);
    });

    test("schedule calendar", async () => {
        const { container } = wrap(
            <ScheduleCalendar
                tasks={[{ id: 1, title: "Refund webhook", planned_date: "2026-10-25", story_points: 5 }]}
                backlogTasks={[{ id: 9, title: "Unscheduled work", story_points: 8 }]}
                mode="month"
                onModeChange={vi.fn()}
                onPlan={vi.fn()}
                onUnschedule={vi.fn()}
                onOpenDetail={vi.fn()}
                today="2026-10-25"
            />,
        );
        await audit(container);
    });

    test("completed section, collapsed and expanded", async () => {
        const props = {
            count: 1,
            tasks: [{ ...task, completed_at: "2026-10-24T10:00:00Z" }],
            loading: false,
            showingAll: false,
            onToggle: vi.fn(),
            onShowAll: vi.fn(),
            onOpenDetail: vi.fn(),
            formatDate: () => "24 Oct",
        };
        const collapsed = wrap(<CompletedSection {...props} open={false} />);
        await audit(collapsed.container);
        collapsed.unmount();

        const expanded = wrap(<CompletedSection {...props} open />);
        await audit(expanded.container);
    });

    test("bulk action bar", async () => {
        const { container } = wrap(
            <BulkActionBar
                count={2}
                applying={false}
                sprints={[{ id: 9, name: "Sprint 24" }]}
                statuses={columns.map((column) => ({ key: column.key, label: column.name }))}
                users={[{ id: 2, full_name: "Ada Lovelace" }]}
                onMoveToSprint={vi.fn()}
                onStatus={vi.fn()}
                onAssign={vi.fn()}
                onDelete={vi.fn()}
                onClear={vi.fn()}
            />,
        );
        await audit(container);
    });

    test("command palette", async () => {
        const items = buildPaletteItems({
            query: "",
            tasks: [{ id: 1, title: "Refund webhook", issue_key: "PAY-142" }],
            views: paletteViews("7"),
            actions: [{ id: "action-new-task", label: "New task", run: vi.fn() }],
            onOpenTask: vi.fn(),
            onGoToView: vi.fn(),
        });
        const { container } = wrap(
            <CommandPalette
                open
                query=""
                setQuery={vi.fn()}
                items={items}
                activeIndex={0}
                setActiveIndex={vi.fn()}
                onKeyDown={vi.fn()}
                onRun={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        await audit(container);
    });

    test("shortcut help", async () => {
        const { container } = wrap(<ShortcutHelp open onClose={vi.fn()} />);
        await audit(container);
    });

    test("task detail sheet", async () => {
        const { container } = wrap(
            <TaskDetailSheet open title="PAY-142 Refund webhook retries" onClose={vi.fn()}>
                <p>Body</p>
            </TaskDetailSheet>,
        );
        await audit(container);
    });
});

describe("drag results and undo are announced", () => {
    test("the board exposes a polite live region for move results", () => {
        wrap(
            <KanbanBoard
                tasks={[task]}
                dragOverCol={null}
                onDragOver={vi.fn()}
                onDragLeave={vi.fn()}
                onDrop={vi.fn()}
                onDragStart={vi.fn()}
                onDragEnd={vi.fn()}
                onOpenDetail={vi.fn()}
                onOpenComments={vi.fn()}
                announcement="Moved Refund webhook retries to In Progress"
            />,
        );
        const live = screen
            .getAllByRole("status")
            .find((node) => node.getAttribute("aria-live") === "polite" && node.textContent?.includes("Moved"));
        expect(live).toBeTruthy();
        expect(live!.textContent).toContain("Moved Refund webhook retries to In Progress");
    });

    test("the undo affordance is a real focusable button", () => {
        const toast = { success: vi.fn() };
        const undo = vi.fn();
        const { result } = renderHook(() => useUndoToast(toast as never, undo));
        result.current("Moved to sprint");

        const node = toast.success.mock.calls[0][0] as React.ReactElement;
        const { container } = render(node);
        const button = container.querySelector("button");
        expect(button).not.toBeNull();
        expect(button!.textContent).toBe("Undo");
        expect(button!.getAttribute("type")).toBe("button");
    });
});
