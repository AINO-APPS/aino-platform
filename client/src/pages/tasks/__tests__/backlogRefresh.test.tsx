/**
 * A background refresh must not blank the backlog.
 *
 * The Backlog tab renders a full-panel spinner whenever `backlogLoading` is
 * true, replacing the whole list. The visible-tab poll runs every 30 seconds
 * and the realtime handlers fire on every teammate edit, so if those refreshes
 * set the loading flag the list disappears and reappears — the "auto refresh
 * flash" users see. Only a user-initiated load may show the spinner.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const getBacklog = vi.fn();

vi.mock("../../../api/tasks", () => ({
    getBacklog: (...args: unknown[]) => getBacklog(...args),
    addBacklogTask: vi.fn(),
    scheduleTask: vi.fn(),
    unscheduleTask: vi.fn(),
    assignTaskToSprint: vi.fn(),
    updateTask: vi.fn(),
    bulkTaskAction: vi.fn(),
}));

vi.mock("../../../api/organization", () => ({
    getTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
    updateTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
}));

vi.mock("../../../hooks/useRealtimeEvent", () => ({
    default: vi.fn(),
}));

// Capture the poll callback so the test can fire it the way the interval does.
const poll = { refresh: null as null | (() => void) };
vi.mock("../hooks/useVisiblePoll", () => ({
    useVisiblePoll: (refresh: () => void) => {
        poll.refresh = refresh;
    },
}));

import { useBacklog } from "../hooks/useBacklog";

function wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={["/tasks/backlog"]}>{children}</MemoryRouter>;
}

function renderBacklog() {
    return renderHook(
        () =>
            useBacklog({
                activeTab: "backlog",
                backlogOpen: false,
                date: "2026-10-25",
                backlogFilters: null,
                selectedSprintId: null,
                showConfirm: vi.fn(),
                closeConfirm: vi.fn(),
                fetchTasks: vi.fn(),
                setError: vi.fn(),
            }),
        { wrapper },
    );
}

const page = {
    tasks: [{ id: 1, title: "Refund webhook retries" }],
    summary: { total: 1, byStatus: {}, byPriority: {} },
    pagination: { total: 1 },
};

describe("backlog background refresh", () => {
    beforeEach(() => {
        getBacklog.mockReset().mockResolvedValue({ data: page });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test("a user-initiated load shows the spinner", async () => {
        const { result } = renderBacklog();

        let pending: Promise<void>;
        act(() => {
            pending = result.current.fetchBacklog();
        });
        expect(result.current.backlogLoading).toBe(true);

        await act(async () => {
            await pending;
        });
        expect(result.current.backlogLoading).toBe(false);
    });

    test("a quiet refresh keeps the list on screen", async () => {
        const { result } = renderBacklog();

        await act(async () => {
            await result.current.fetchBacklog();
        });
        expect(result.current.backlogTasks).toHaveLength(1);

        let pending: Promise<void>;
        act(() => {
            pending = result.current.fetchBacklog(true);
        });
        // The rows stay rendered: no spinner, no blank list.
        expect(result.current.backlogLoading).toBe(false);
        expect(result.current.backlogTasks).toHaveLength(1);

        await act(async () => {
            await pending;
        });
        expect(result.current.backlogLoading).toBe(false);
        expect(result.current.backlogTasks).toHaveLength(1);
    });

    test("the visible-tab poll refreshes quietly", async () => {
        const { result } = renderBacklog();

        await act(async () => {
            await result.current.fetchBacklog();
        });
        getBacklog.mockClear();

        // Fire the poll the way the 30s interval does.
        expect(poll.refresh).toBeTypeOf("function");
        await act(async () => {
            poll.refresh!();
        });

        await waitFor(() => expect(getBacklog).toHaveBeenCalled());
        expect(result.current.backlogLoading).toBe(false);
        expect(result.current.backlogTasks).toHaveLength(1);
    });
});
