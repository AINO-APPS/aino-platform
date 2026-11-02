import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTaskDeltas } from "../hooks/useTaskDeltas";
import { REALTIME_EVENT } from "../../../hooks/useWebSocket";
import ticket from "../../../../../contracts/fixtures/ticket-with-capabilities.json";
import { getTaskDetail } from "../../../api/tasks";

vi.mock("../../../api/tasks", () => ({ getTaskDetail: vi.fn() }));
async function emit(data: unknown) {
    await act(async () => {
        window.dispatchEvent(new CustomEvent(REALTIME_EVENT, {
            detail: { type: "task_updated", data },
        }));
    });
}

describe("realtime ticket freshness", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.mocked(getTaskDetail).mockReset().mockResolvedValue({ data: ticket } as any);
    });
    afterEach(() => vi.useRealTimers());

    test("a successful refetch attributes the affected card, then clears the attribution", async () => {
        const { result } = renderHook(() => useTaskDeltas(vi.fn(), { attributionMs: 1000 }));
        await emit({ taskId: 42, actor: { id: 3, name: "Ada" }, at: "2026-11-02T10:00:00Z" });
        expect(result.current.attribution["42"]).toMatchObject({ name: "Ada" });
        act(() => vi.advanceTimersByTime(1000));
        expect(result.current.attribution["42"]).toBeUndefined();
    });

    test("a failed refetch retains the last fetched ticket", async () => {
        vi.mocked(getTaskDetail).mockRejectedValue(new Error("offline"));
        let tasks = [ticket];
        const setTasks = (updater: any) => { tasks = updater(tasks); };
        renderHook(() => useTaskDeltas(setTasks));
        await emit({ taskId: 42, fields: { title: "Not authoritative" } });
        expect(tasks).toEqual([ticket]);
    });

    test("an older timestamp cannot replace a newer refetched ticket", async () => {
        const fresh = { ...ticket, title: "Newer" };
        vi.mocked(getTaskDetail).mockResolvedValue({ data: fresh } as any);
        let tasks = [ticket];
        renderHook(() => useTaskDeltas((updater) => { tasks = updater(tasks); }));
        await emit({ taskId: 42, at: "2026-11-02T10:00:01Z" });
        await emit({ taskId: 42, at: "2026-11-02T10:00:00Z" });
        expect(tasks).toEqual([fresh]);
        expect(getTaskDetail).toHaveBeenCalledTimes(1);
    });
});
