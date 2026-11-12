import React from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useProjectScope } from "../hooks/useProjectScope";
import { getSprints } from "../../../api/tasks";

vi.mock("../../../api/tasks", () => ({
    getSprints: vi.fn(async (params: any) => ({
        data: { sprints: [{ id: params.project_id * 10, project_id: params.project_id, status: "active" }], currentSprintId: params.project_id * 10 },
    })),
}));
const projects = [{ id: 1, key: "ONE", name: "One" }, { id: 2, key: "TWO", name: "Two" }];
function wrapper({ children }: { children: React.ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
test("selecting a project scopes backlog requests and the board sprint, and persists the project", async () => {
    const options = { projects, enabled: true, agileEnabled: true, userKey: "1:5", setSelectedSprintId: vi.fn() };
    const { result, unmount } = renderHook(() => useProjectScope(options), { wrapper });
    await waitFor(() => expect(result.current.currentSprintId).toBe(10));
    expect(result.current.scopeParams).toEqual({ project_id: 1 });
    act(() => result.current.changeProject(2));
    expect(result.current.scopeParams).toEqual({ project_id: 2 });
    expect(result.current.visibleSprints).toEqual([]);
    await waitFor(() => expect(result.current.currentSprintId).toBe(20));
    expect(result.current.visibleSprints.map((sprint: any) => sprint.id)).toEqual([20]);
    expect(getSprints).toHaveBeenLastCalledWith({ project_id: 2 });
    unmount();
    const again = renderHook(() => useProjectScope(options), { wrapper });
    await waitFor(() => expect(again.result.current.selectedProjectId).toBe(2));
});

test("server sprint capability survives agile loss and non-Scrum stops sprint requests", async () => {
    const options = { projects: [{ id: 1, hasSprints: true }, { id: 2, hasSprints: false }], enabled: true, agileEnabled: false, userKey: "1:5", setSelectedSprintId: vi.fn() };
    const { result } = renderHook(() => useProjectScope(options), { wrapper });
    await waitFor(() => expect(result.current.currentSprintId).toBe(10));
    act(() => result.current.changeProject(2));
    await waitFor(() => expect(result.current.currentSprintLoaded).toBe(true));
    expect(result.current.currentSprintId).toBeNull();
    expect(getSprints).toHaveBeenCalledTimes(1);
});
