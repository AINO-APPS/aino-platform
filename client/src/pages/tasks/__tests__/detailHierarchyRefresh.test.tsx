import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useTaskDetail } from "../hooks/useTaskDetail";
import ticket from "../../../../../contracts/fixtures/ticket-with-capabilities.json";

const api = vi.hoisted(() => ({ getTaskDetail: vi.fn() }));
vi.mock("../../../api/tasks", () => ({
    getTaskDetail: api.getTaskDetail,
    getTaskHistory: vi.fn().mockResolvedValue({ data: [] }),
}));
vi.mock("../../../hooks/useRealtimeEvent", () => ({ default: vi.fn() }));

test("a write response without hierarchy refreshes the open detail's live family totals", async () => {
    const parent = { ...ticket, id: 7, subtasks: [{ id: 8 }], effort: { total_time_spent_minutes: 60 } };
    api.getTaskDetail.mockResolvedValueOnce({ data: parent })
        .mockResolvedValue({ data: { ...parent, effort: { total_time_spent_minutes: 90 } } });
    const { result } = renderHook(() => useTaskDetail({
        activeTab: "backlog", showConfirm: vi.fn(), closeConfirm: vi.fn(), setTasks: vi.fn(),
        setBacklogTasks: vi.fn(), fetchTasks: vi.fn(), fetchBacklog: vi.fn(), setError: vi.fn(),
    }));
    await act(async () => { await result.current.openTaskDetail(parent as any); });
    await act(async () => { result.current.replaceTicket({ ...ticket, id: 7 } as any); });
    await waitFor(() => expect(result.current.detailTask?.effort?.total_time_spent_minutes).toBe(90));
    expect(result.current.detailTask?.subtasks).toEqual([{ id: 8 }]);
});
