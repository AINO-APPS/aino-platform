import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useTicketLifecycle } from "../hooks/useTicketLifecycle";

describe("ticket lifecycle sprint defaults", () => {
    test("adds a backlog ticket to the server's paused current sprint", () => {
        const showConfirm = vi.fn();
        const { result } = renderHook(() => useTicketLifecycle({
            availableSprints: [
                { id: 50, name: "Future sprint", status: "planned" },
                { id: 51, name: "Paused sprint", status: "paused" },
            ],
            currentSprintId: 51,
            selectedSprintId: null,
            activeTab: "backlog",
            showConfirm,
            closeConfirm: vi.fn(),
            setError: vi.fn(),
            fetchTasks: vi.fn(),
            fetchBacklog: vi.fn(),
            toast: { success: vi.fn() },
        }));

        act(() => result.current.addToSprint({ id: 8, title: "Ticket 8" }));
        expect(showConfirm).toHaveBeenCalledWith(
            "Add to sprint",
            'Move "Ticket 8" into Paused sprint?',
            expect.any(Function),
            { confirmText: "Add" },
        );
    });
});
