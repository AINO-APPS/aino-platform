/**
 * Saving the sprint goal updates the sprint the page renders from.
 *
 * `SprintPlan` resyncs its inline goal from the selected sprint. If the sprint
 * in the cache keeps the old goal, the next resync overwrites the value the
 * user just saved.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

const updateSprint = vi.fn().mockResolvedValue({ data: {} });

vi.mock("../../../api/tasks", () => ({
    assignTaskToSprint: vi.fn(),
    getRecentVelocity: vi.fn().mockResolvedValue({ data: { sprints: [], average: 0 } }),
    getSprintBaseline: vi.fn().mockResolvedValue({ data: {} }),
    getSprintBurndown: vi.fn().mockResolvedValue({ data: [] }),
    updateSprint: (...args: unknown[]) => updateSprint(...args),
}));

import { useSprintPlan } from "../hooks/useSprintPlan";

function setup() {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["tasks", "availableSprints"], [
        { id: 9, name: "Sprint 24", goal: "Old goal" },
        { id: 10, name: "Sprint 25", goal: "Other" },
    ]);
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
        () =>
            useSprintPlan({
                sprintId: 9,
                fetchTasks: vi.fn(),
                fetchBacklog: vi.fn(),
                onError: vi.fn(),
            }),
        { wrapper },
    );
    return { queryClient, result };
}

describe("useSprintPlan.saveGoal", () => {
    test("writes the saved goal back into the cached sprint", async () => {
        const { queryClient, result } = setup();

        await act(async () => {
            await result.current.saveGoal("Refunds never double");
        });

        expect(updateSprint).toHaveBeenCalledWith(9, { goal: "Refunds never double" });
        const sprints = queryClient.getQueryData<any[]>(["tasks", "availableSprints"])!;
        expect(sprints.find((sprint) => sprint.id === 9)?.goal).toBe("Refunds never double");
        expect(sprints.find((sprint) => sprint.id === 10)?.goal).toBe("Other");
    });
});
