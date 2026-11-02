import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import ticket from "../../../../../contracts/fixtures/ticket-with-capabilities.json";
import { bulkTaskAction } from "../../../api/tasks";
import { describeSkipped, useBulkSelection } from "../hooks/useBulkSelection";
import { getBacklog } from "../../../api/tasks";
import { useBacklog } from "../hooks/useBacklog";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../api/tasks", () => ({
    bulkTaskAction: vi.fn(), getBacklog: vi.fn(), addBacklogTask: vi.fn(),
    scheduleTask: vi.fn(), unscheduleTask: vi.fn(), assignTaskToSprint: vi.fn(), updateTask: vi.fn(),
}));
vi.mock("../../../api/organization", () => ({
    getTaskPreferences: vi.fn(async () => ({ data: {} })),
    updateTaskPreferences: vi.fn(async () => ({ data: {} })),
}));

test("bulk writes send only allowed tickets and show each skipped ticket's shared reason copy", async () => {
    const denied = {
        ...ticket, id: 43, title: "Frozen ticket",
        capabilities: { ...ticket.capabilities, can: { ...ticket.capabilities.can, delete: { allowed: false, reason: "SPRINT_FROZEN" } } },
    };
    vi.mocked(bulkTaskAction).mockResolvedValue({ data: { changed: 1, results: [{ id: 42, ok: true, ticket }] } } as any);
    const onApplied = vi.fn();
    const { result } = renderHook(() => useBulkSelection({ tasks: [ticket, denied], onApplied }));
    act(() => result.current.selectAll([42, 43]));
    await act(() => result.current.apply("delete", null));
    expect(bulkTaskAction).toHaveBeenCalledWith({ ids: [42], action: "delete", value: null });
    const results = onApplied.mock.calls[0][2];
    expect(results).toContainEqual({ id: 43, ok: false, code: "SPRINT_FROZEN" });
    expect(describeSkipped(results, [ticket, denied])).toContain("Frozen ticket: This sprint is frozen. Move the ticket out first.");
});

test("bulk writes replace backlog rows from the API result.ticket before list refetch completes", async () => {
    const fresh = { ...ticket, title: "Fresh bulk response", serverOnly: true };
    vi.mocked(getBacklog).mockResolvedValueOnce({ data: { tasks: [ticket] } } as any)
        .mockReturnValue(new Promise(() => {}));
    vi.mocked(bulkTaskAction).mockResolvedValue({ data: { changed: 1, results: [{ id: 42, ok: true, ticket: fresh }] } } as any);
    const { result } = renderHook(() => useBacklog({
        activeTab: "backlog", backlogOpen: false, date: "2026-11-02", backlogFilters: null,
        selectedSprintId: null, showConfirm: vi.fn(), closeConfirm: vi.fn(), fetchTasks: vi.fn(), setError: vi.fn(),
    }), { wrapper: ({ children }) => <MemoryRouter>{children}</MemoryRouter> });
    await act(async () => { await result.current.fetchBacklog(); });
    act(() => result.current.bulk.selectAll([42]));
    await act(async () => { await result.current.bulk.apply("assign", 9); });
    expect(result.current.backlogTasks).toEqual([fresh]);
});
