import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TaskDetailSheet from "../TaskDetailSheet";
import TaskTimePanel from "../TaskTimePanel";
import { formatMinutes, summariseTime } from "../time";

const logTaskWork = vi.fn();
const getTaskWorklogs = vi.fn();

vi.mock("../../../api/tasks", () => ({
    logTaskWork: (...args: unknown[]) => logTaskWork(...args),
    getTaskWorklogs: (...args: unknown[]) => getTaskWorklogs(...args),
}));

beforeEach(() => {
    logTaskWork.mockReset();
    getTaskWorklogs.mockReset().mockResolvedValue({ data: { worklogs: [], time_spent_minutes: 0 } });
});

describe("TaskDetailSheet", () => {
    test("renders as a dialog with the task title", () => {
        render(
            <TaskDetailSheet open title="PAY-142 Refund webhook" onClose={vi.fn()}>
                <p>Body</p>
            </TaskDetailSheet>,
        );
        expect(screen.getByRole("dialog", { name: "PAY-142 Refund webhook" })).toBeTruthy();
        expect(screen.getByText("Body")).toBeTruthy();
    });

    test("closes with escape", () => {
        const onClose = vi.fn();
        render(
            <TaskDetailSheet open title="Task" onClose={onClose}>
                <p>Body</p>
            </TaskDetailSheet>,
        );
        fireEvent.keyDown(document, { key: "Escape" });
        expect(onClose).toHaveBeenCalled();
    });

    test("the close control is keyboard reachable", () => {
        render(
            <TaskDetailSheet open title="Task" onClose={vi.fn()}>
                <p>Body</p>
            </TaskDetailSheet>,
        );
        expect(screen.getByRole("button", { name: "Close task detail" }).tagName).toBe("BUTTON");
    });

    test("renders nothing when closed", () => {
        const { container } = render(
            <TaskDetailSheet open={false} title="Task" onClose={vi.fn()}>
                <p>Body</p>
            </TaskDetailSheet>,
        );
        expect(container.firstChild).toBeNull();
    });

    test("header badges and actions are rendered alongside the title", () => {
        render(
            <TaskDetailSheet
                open
                title="Task"
                onClose={vi.fn()}
                badges={<span>High</span>}
                actions={<button type="button">Edit</button>}
            >
                <p>Body</p>
            </TaskDetailSheet>,
        );
        expect(screen.getByText("High")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    });

    test("does not trap the keyboard inside the sheet", () => {
        render(
            <TaskDetailSheet open title="Task" onClose={vi.fn()}>
                <button type="button">Inside</button>
            </TaskDetailSheet>,
        );
        const dialog = screen.getByRole("dialog");
        // aria-modal is false and there is no focus-trap handler, so Tab can
        // leave the sheet for the page behind it.
        expect(dialog.getAttribute("aria-modal")).toBe("false");
    });
});

describe("TaskTimePanel", () => {
    test("shows read-only worklogs with author, day, duration and migration comment below the time panel", async () => {
        getTaskWorklogs.mockResolvedValue({ data: { time_spent_minutes: 90, worklogs: [
            { id: 1, task_id: 1, author_id: 1, logged_by_id: 1, author: { full_name: 'Alice' }, logged_by: { full_name: 'Alice' },
                day_worked: '2026-11-02', minutes: 90, comment: 'Migrated from timer', start_time: '09:30:00' },
        ] } });
        render(<TaskTimePanel task={{ id: 1, time_spent_minutes: 90 }} />);
        const list = await screen.findByRole('list', { name: 'Worklogs' });
        expect(list.textContent).toContain('Alice');
        expect(list.textContent).toContain('1h 30m');
        expect(list.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-02');
        expect(list.textContent).toContain('Migrated from timer');
        expect(screen.queryByRole('button', { name: /Edit worklog|Delete worklog|Log work/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /Start timer|Stop timer/ })).toBeNull();
    });

    test("worklog load failure is visible", async () => {
        getTaskWorklogs.mockRejectedValue(new Error('offline'));
        render(<TaskTimePanel task={{ id: 1 }} />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load worklogs');
        expect(screen.queryByRole('button', { name: /Start timer|Stop timer/ })).toBeNull();
    });
    test("shows logged against estimated", async () => {
        render(<TaskTimePanel task={{ id: 1, original_estimate_minutes: 120, time_spent_minutes: 45 }} />);
        expect(await screen.findByText("45m / 2h")).toBeTruthy();
    });

    test("an overrun is labelled", async () => {
        render(<TaskTimePanel task={{ id: 1, original_estimate_minutes: 60, time_spent_minutes: 90 }} />);
        expect(await screen.findByText("Over estimate")).toBeTruthy();
    });
});

describe("time helpers", () => {
    test("summarises logged against estimated", () => {
        expect(summariseTime({ original_estimate_minutes: 120, time_spent_minutes: 45 })).toMatchObject({
            estimated: 120,
            logged: 45,
            remaining: 75,
            percent: 38,
            over: false,
        });
    });

    test("formats minutes readably", () => {
        expect(formatMinutes(90)).toBe("1h 30m");
        expect(formatMinutes(45)).toBe("45m");
    });
});
