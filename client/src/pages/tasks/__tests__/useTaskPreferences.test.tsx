import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { useTaskPreferences } from "../hooks/useTaskPreferences";

const getTaskPreferences = vi.fn();
const updateTaskPreferences = vi.fn();

vi.mock("../../../api/organization", () => ({
    getTaskPreferences: (...args: unknown[]) => getTaskPreferences(...args),
    updateTaskPreferences: (...args: unknown[]) => updateTaskPreferences(...args),
}));

function wrapper(initialEntry = "/tasks/backlog") {
    return ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
    );
}

describe("useTaskPreferences", () => {
    beforeEach(() => {
        getTaskPreferences.mockReset();
        updateTaskPreferences.mockReset();
    });

    test("defaults to hidden completed work", async () => {
        getTaskPreferences.mockResolvedValue({ data: {} });
        const { result } = renderHook(() => useTaskPreferences(), { wrapper: wrapper() });

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.showCompleted).toBe(false);
        expect(result.current.preferences.card_density).toBe("comfortable");
    });

    test("reads the stored preference", async () => {
        getTaskPreferences.mockResolvedValue({
            data: { show_completed: true, card_density: "compact", default_team_id: 2 },
        });
        const { result } = renderHook(() => useTaskPreferences(), { wrapper: wrapper() });

        await waitFor(() => expect(result.current.showCompleted).toBe(true));
        expect(result.current.preferences.card_density).toBe("compact");
    });

    test("a URL parameter overrides the stored choice for that view", async () => {
        getTaskPreferences.mockResolvedValue({ data: { show_completed: false } });
        const { result } = renderHook(() => useTaskPreferences(), {
            wrapper: wrapper("/tasks/backlog?completed=1"),
        });

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.showCompleted).toBe(true);
        expect(result.current.overridden).toBe(true);
        expect(result.current.preferences.show_completed).toBe(false);
    });

    test("the override does not persist", async () => {
        getTaskPreferences.mockResolvedValue({ data: { show_completed: false } });
        renderHook(() => useTaskPreferences(), {
            wrapper: wrapper("/tasks/backlog?completed=1"),
        });

        await waitFor(() => expect(getTaskPreferences).toHaveBeenCalled());
        expect(updateTaskPreferences).not.toHaveBeenCalled();
    });

    test("toggling saves server-side", async () => {
        getTaskPreferences.mockResolvedValue({ data: { show_completed: false } });
        updateTaskPreferences.mockResolvedValue({ data: { show_completed: true } });
        const { result } = renderHook(() => useTaskPreferences(), { wrapper: wrapper() });

        await waitFor(() => expect(result.current.loaded).toBe(true));
        await act(async () => {
            result.current.setShowCompleted(true);
        });

        expect(updateTaskPreferences).toHaveBeenCalledWith({ show_completed: true });
        await waitFor(() => expect(result.current.showCompleted).toBe(true));
    });

    test("a failed read falls back to defaults instead of blocking", async () => {
        getTaskPreferences.mockRejectedValue(new Error("offline"));
        const { result } = renderHook(() => useTaskPreferences(), { wrapper: wrapper() });

        await waitFor(() => expect(result.current.loaded).toBe(true));
        expect(result.current.showCompleted).toBe(false);
    });
});
