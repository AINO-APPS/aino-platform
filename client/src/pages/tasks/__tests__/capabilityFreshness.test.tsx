import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import ticket from "../../../../../contracts/fixtures/ticket-with-capabilities.json";
import { useBacklogInlineEdit } from "../hooks/useBacklogInlineEdit";
import { useTaskDeltas } from "../hooks/useTaskDeltas";
import { REALTIME_EVENT } from "../../../hooks/useWebSocket";
import { getTaskDetail, updateTask, updateTaskStatus, getTaskHistory } from "../../../api/tasks";
import { useTaskDetail } from "../hooks/useTaskDetail";

vi.mock("../../../api/tasks", () => ({ updateTask: vi.fn(), getTaskDetail: vi.fn(), updateTaskStatus: vi.fn(), getTaskHistory: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

test("inline writes replace the whole ticket and use the returned container, not edited date fields", async () => {
    const fresh = { ...ticket, title: "Server title", due_date: "2026-11-20", serverOnly: true };
    vi.mocked(updateTask).mockResolvedValue({ data: fresh } as any);
    const onMoved = vi.fn();
    const { result } = renderHook(() => {
        const [tasks, setTasks] = useState<any[]>([{ ...ticket, staleOnly: true }]);
        const edit = useBacklogInlineEdit({
            setBacklogTasks: setTasks, fetchBacklog: vi.fn(), setError: vi.fn(),
            undo: { register: vi.fn() }, onMoved,
        });
        return { tasks, edit };
    });
    await act(() => result.current.edit(ticket as any, { due_date: "2026-11-20" }));
    expect(result.current.tasks).toEqual([fresh]);
    expect(onMoved).not.toHaveBeenCalled();
});

test("task_updated without fields refetches per-user capabilities instead of patching event data", async () => {
    const fresh = {
        ...ticket,
        title: "Fresh title",
        capabilities: { ...ticket.capabilities, can: { ...ticket.capabilities.can, edit: { allowed: false, reason: "ACCESS_DENIED" } } },
    };
    vi.mocked(getTaskDetail).mockResolvedValue({ data: fresh } as any);
    const { result } = renderHook(() => {
        const [tasks, setTasks] = useState<any[]>([ticket]);
        useTaskDeltas(setTasks);
        return tasks;
    });

    await act(async () => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, {
        detail: { type: "task_updated", data: { taskId: 42, action: "updated", fields: { title: "Do not trust me" } } },
    })); });
    await waitFor(() => expect(result.current).toEqual([fresh]));
    await act(async () => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, {
        detail: { type: "task_updated", data: { taskId: 42, action: "updated" } },
    })); });
    await waitFor(() => expect(getTaskDetail).toHaveBeenCalledTimes(2));
});

test("detail state writes replace detail and list entries directly from the enriched response", async () => {
    let confirm: () => void = () => {};
    const fresh = { ...ticket, title: "Authoritative response", workflow_state_id: 103, extra: "from server" };
    vi.mocked(updateTaskStatus).mockResolvedValue({ data: fresh } as any);
    vi.mocked(getTaskHistory).mockResolvedValue({ data: [] } as any);
    const { result } = renderHook(() => {
        const [tasks, setTasks] = useState<any[]>([ticket]);
        const [backlog, setBacklogTasks] = useState<any[]>([ticket]);
        const detail = useTaskDetail({
            activeTab: "backlog", showConfirm: (_title, _message, onConfirm) => { confirm = onConfirm; },
            closeConfirm: vi.fn(), setTasks, setBacklogTasks, fetchTasks: vi.fn(), fetchBacklog: vi.fn(), setError: vi.fn(),
        });
        return { tasks, backlog, ...detail };
    });
    act(() => result.current.setDetailTask(ticket as any));
    act(() => result.current.handleDetailStatusChange(ticket as any, { id: 103, label: "Review" }));
    await act(async () => { await confirm(); });
    await waitFor(() => expect(result.current.detailTask).toEqual(fresh));
    expect(result.current.tasks).toEqual([fresh]);
    expect(result.current.backlog).toEqual([fresh]);
});

test("detail saves canonical start date and preserves the selected sprint", async () => {
    let confirm: () => void = () => {};
    const fresh = { ...ticket, start_date: "2026-11-12", planned_date: "2026-11-12", sprint_id: 10 };
    vi.mocked(updateTask).mockResolvedValue({ data: fresh } as any);
    vi.mocked(getTaskHistory).mockResolvedValue({ data: [] } as any);
    const { result } = renderHook(() => useTaskDetail({
        activeTab: "sprint", showConfirm: (_title, _message, onConfirm) => { confirm = onConfirm; },
        closeConfirm: vi.fn(), setTasks: vi.fn(), setBacklogTasks: vi.fn(), fetchTasks: vi.fn(), fetchBacklog: vi.fn(), setError: vi.fn(),
    }));
    act(() => result.current.setDetailTask({ ...ticket, sprint_id: 10 } as any));
    act(() => result.current.saveDetailEdit({ startDate: "2026-11-12", sprintId: 10 }));
    await act(async () => { await confirm(); });
    expect(updateTask).toHaveBeenCalledWith(ticket.id, expect.objectContaining({ start_date: "2026-11-12", sprint_id: 10 }));
    expect(vi.mocked(updateTask).mock.calls[0][1]).not.toHaveProperty("planned_date");
    expect(result.current.detailTask).toEqual(fresh);
});

test("rejected writes use the same ACCESS_DENIED copy as disabled controls", async () => {
    vi.mocked(updateTask).mockRejectedValue({ response: { data: { code: "ACCESS_DENIED", error: "Different server prose" } } });
    const setError = vi.fn();
    const { result } = renderHook(() => useBacklogInlineEdit({
        setBacklogTasks: vi.fn(), fetchBacklog: vi.fn(), setError, undo: { register: vi.fn() },
    }));
    await act(() => result.current(ticket as any, { title: "Rejected" }));
    expect(setError).toHaveBeenCalledWith("You do not have permission to do this.");
});

test("a project key rename refreshes open boards, lists and the matching ticket detail", async () => {
    const fresh = { ...ticket, project_id: 10, ticket_key: "NEW-2" };
    vi.mocked(getTaskDetail).mockResolvedValue({ data: fresh } as any);
    const refresh = vi.fn();
    const { result } = renderHook(() => {
        const [tasks, setTasks] = useState<any[]>([{ ...ticket, project_id: 10, ticket_key: "OLD-2" }]);
        const detail = useTaskDetail({
            activeTab: "backlog", showConfirm: vi.fn(), closeConfirm: vi.fn(),
            setTasks, setBacklogTasks: vi.fn(), fetchTasks: vi.fn(), fetchBacklog: vi.fn(), setError: vi.fn(),
        });
        useTaskDeltas(setTasks, { onRefresh: refresh });
        return { tasks, ...detail };
    });
    act(() => result.current.setDetailTask({ ...ticket, project_id: 10, ticket_key: "OLD-2" } as any));
    await act(async () => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, {
        detail: { type: "project_updated", data: { project_id: 10 } },
    })); });
    await waitFor(() => expect(result.current.detailTask?.ticket_key).toBe("NEW-2"));
    expect(result.current.tasks[0].ticket_key).toBe("NEW-2");
    expect(refresh).toHaveBeenCalledTimes(1);
});
