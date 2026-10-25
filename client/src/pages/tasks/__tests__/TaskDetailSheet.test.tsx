import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TaskDetailSheet from "../TaskDetailSheet";
import TaskTimePanel from "../TaskTimePanel";
import { formatMinutes, summariseTime } from "../time";

const getTaskTimer = vi.fn();
const startTaskTimer = vi.fn();
const stopTaskTimer = vi.fn();

vi.mock("../../../api/tasks", () => ({
    getTaskTimer: (...args: unknown[]) => getTaskTimer(...args),
    startTaskTimer: (...args: unknown[]) => startTaskTimer(...args),
    stopTaskTimer: (...args: unknown[]) => stopTaskTimer(...args),
}));

beforeEach(() => {
    getTaskTimer.mockReset().mockResolvedValue({ data: { running: false } });
    startTaskTimer.mockReset().mockResolvedValue({ data: { running: true } });
    stopTaskTimer.mockReset().mockResolvedValue({ data: { minutes: 15 } });
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
