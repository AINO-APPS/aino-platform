import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";

vi.mock("../../AgileConfigContext", () => ({
    useAgileConfig: () => ({ unitLabel: "points" }),
}));
vi.mock("../../components/agile/AgileWorkflowPanels", () => ({
    BurndownChart: () => null,
    VelocityChart: () => null,
}));
vi.mock("../../api/tasks", () => ({
    getSprints: vi.fn(async () => ({
        data: {
            currentSprintId: 21,
            sprints: [
                { id: 20, name: "Future sprint", status: "planned" },
                { id: 21, name: "Paused sprint", status: "paused" },
            ],
        },
    })),
    getSprintStats: vi.fn(async () => ({ data: null })),
    getSprintCumulativeFlow: vi.fn(async () => ({ data: null })),
    getSprintCycleTime: vi.fn(async () => ({ data: null })),
    getSprintRetrospective: vi.fn(async () => ({ data: { retrospective: null } })),
    getSprintTasks: vi.fn(async () => ({ data: { tasks: [] } })),
    updateSprintRetrospective: vi.fn(),
}));

import SprintInsights from "../SprintInsights";

describe("Sprint Insights selection", () => {
    test("defaults to the server's paused current sprint", async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <QueryClientProvider client={client}>
                <MemoryRouter>
                    <SprintInsights />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        const sprintSelect = await screen.findByRole("combobox");
        await waitFor(() => expect((sprintSelect as HTMLSelectElement).value).toBe("21"));
        expect(screen.getByRole("option", { name: "Paused sprint" })).toBeTruthy();
    });
});
