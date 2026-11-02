import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useSprintBoardActions } from "../hooks/useSprintBoardActions";

describe("sprint board actions", () => {
    test("plan sprint opens the server's paused current sprint", () => {
        const setSelectedSprintId = vi.fn();
        const goToView = vi.fn();
        const { result } = renderHook(() => useSprintBoardActions({
            visibleSprints: [
                { id: 50, status: "planned" },
                { id: 51, status: "paused" },
            ],
            currentSprintId: 51,
            selectedSprintId: null,
            teamScopeParams: {},
            currentUser: { role: "team_lead" },
            setSelectedSprintId,
            goToView,
            fetchTasks: vi.fn(),
            setError: vi.fn(),
            toast: { success: vi.fn(), info: vi.fn() },
        }));

        act(() => result.current.planSprint());
        expect(setSelectedSprintId).toHaveBeenCalledWith(51);
        expect(goToView).toHaveBeenCalledWith("sprint", 51, true);
    });
});
