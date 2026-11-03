import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TaskDetailSheet from "../TaskDetailSheet";
import TaskTimePanel from "../TaskTimePanel";
import { formatMinutes, summariseTime } from "../time";

const getTaskTimer = vi.fn();
const startTaskTimer = vi.fn();
const stopTaskTimer = vi.fn();
const getTaskWorklogs = vi.fn();

vi.mock("../../../api/tasks", () => ({
    getTaskTimer: (...args: unknown[]) => getTaskTimer(...args),
    startTaskTimer: (...args: unknown[]) => startTaskTimer(...args),
    stopTaskTimer: (...args: unknown[]) => stopTaskTimer(...args),
    getTaskWorklogs: (...args: unknown[]) => getTaskWorklogs(...args),
}));

beforeEach(() => {
    getTaskTimer.mockReset().mockResolvedValue({ data: { running: false } });
    startTaskTimer.mockReset().mockResolvedValue({ data: { running: true } });
    stopTaskTimer.mockReset().mockResolvedValue({ data: { minutes: 15, time: { logged: 25 } } });
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
        render(<TaskTimePanel task={{ id: 1, logged_minutes: 90 }} />);
        const list = await screen.findByRole('list', { name: 'Worklogs' });
        expect(list.textContent).toContain('Alice');
        expect(list.textContent).toContain('1h 30m');
        expect(list.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-02');
        expect(list.textContent).toContain('Migrated from timer');
        expect(screen.queryByRole('button', { name: /Edit worklog|Delete worklog|Log work/ })).toBeNull();
        expect(screen.getByRole('button', { name: /Start timer/ })).toBeTruthy();
    });

    test("stopping refreshes the list and trusts the server total rather than adding to stale ticket time", async () => {
        getTaskTimer.mockResolvedValue({ data: { running: true } });
        stopTaskTimer.mockResolvedValue({ data: { minutes: 1, time: { logged: 31 } } });
        getTaskWorklogs.mockResolvedValueOnce({ data: { worklogs: [], time_spent_minutes: 30 } })
            .mockResolvedValue({ data: { time_spent_minutes: 31, worklogs: [{ id: 4, author_id: 1, logged_by_id: 1, author: { full_name: 'Alice' }, day_worked: '2026-11-03', minutes: 1, comment: 'Latest stop' }] } });
        render(<TaskTimePanel task={{ id: 1, logged_minutes: 999 }} />);
        fireEvent.click(await screen.findByRole('button', { name: /Stop timer/ }));
        expect(await screen.findByText('Latest stop')).toBeTruthy();
        expect(screen.getByText('31m / —')).toBeTruthy();
    });

    test("worklog load failure is visible without removing the timer", async () => {
        getTaskWorklogs.mockRejectedValue(new Error('offline'));
        render(<TaskTimePanel task={{ id: 1 }} />);
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load worklogs');
        expect(screen.getByRole('button', { name: /Start timer/ })).toBeTruthy();
    });

    test("shows logged against estimated", async () => {
        render(<TaskTimePanel task={{ id: 1, estimated_minutes: 120, logged_minutes: 45 }} />);
        expect(await screen.findByText("45m / 2h")).toBeTruthy();
    });

    test("starting the timer calls the API and offers stop", async () => {
        render(<TaskTimePanel task={{ id: 1 }} />);
        fireEvent.click(await screen.findByRole("button", { name: /Start timer/ }));
        await waitFor(() => expect(startTaskTimer).toHaveBeenCalledWith(1));
        expect(await screen.findByRole("button", { name: /Stop timer/ })).toBeTruthy();
    });

    test("a running timer offers stop and reports the logged minutes", async () => {
        getTaskTimer.mockResolvedValue({ data: { running: true } });
        const onLogged = vi.fn();
        render(<TaskTimePanel task={{ id: 1, logged_minutes: 10 }} onLogged={onLogged} />);
        fireEvent.click(await screen.findByRole("button", { name: /Stop timer/ }));
        await waitFor(() => expect(stopTaskTimer).toHaveBeenCalledWith(1));
        expect(onLogged).toHaveBeenCalledWith(15);
        expect(await screen.findByText("25m / —")).toBeTruthy();
    });

    test("an overrun is labelled", async () => {
        render(<TaskTimePanel task={{ id: 1, estimated_minutes: 60, logged_minutes: 90 }} />);
        expect(await screen.findByText("Over estimate")).toBeTruthy();
    });

    test("a failed start is announced rather than swallowed", async () => {
        startTaskTimer.mockRejectedValue(new Error("nope"));
        render(<TaskTimePanel task={{ id: 1 }} />);
        fireEvent.click(await screen.findByRole("button", { name: /Start timer/ }));
        expect(await screen.findByRole("alert")).toBeTruthy();
    });
});

describe("time helpers", () => {
    test("summarises logged against estimated", () => {
        expect(summariseTime({ estimated_minutes: 120, logged_minutes: 45 })).toMatchObject({
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
