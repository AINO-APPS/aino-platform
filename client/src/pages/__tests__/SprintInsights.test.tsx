import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import noCurrentSprint from "../../../../contracts/fixtures/sprint-list.no-current.json";
import { getSprints, getSprintStats } from "../../api/tasks";

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
    test.each(["planned", "completed"])("no current sprint stays unselected with %s listed first", async (firstStatus) => {
        const sprints = firstStatus === "planned" ? noCurrentSprint.data.sprints : [...noCurrentSprint.data.sprints].reverse();
        vi.mocked(getSprints).mockResolvedValueOnce({ data: { ...noCurrentSprint.data, sprints } } as any);
        vi.mocked(getSprintStats).mockClear();
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <QueryClientProvider client={client}>
                <MemoryRouter>
                    <SprintInsights />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        await screen.findByRole("option", { name: "Future sprint" });
        const sprintSelect = screen.getByRole("combobox");
        expect(sprintSelect).toHaveValue("");
        expect(screen.getByText("Select a sprint to see insights.")).toBeInTheDocument();
        expect(getSprintStats).not.toHaveBeenCalled();

        fireEvent.change(sprintSelect, { target: { value: "19" } });
        await waitFor(() => expect(getSprintStats).toHaveBeenCalledWith(19));
        expect(sprintSelect).toHaveValue("19");
    });

    test("an explicit sprint link still selects a planned sprint without a current sprint", async () => {
        vi.mocked(getSprints).mockResolvedValueOnce({ data: noCurrentSprint.data } as any);
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <QueryClientProvider client={client}>
                <MemoryRouter initialEntries={["/?sprint_id=20"]}>
                    <SprintInsights />
                </MemoryRouter>
            </QueryClientProvider>,
        );

        await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("20"));
        expect(screen.queryByText("Select a sprint to see insights.")).not.toBeInTheDocument();
    });

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
