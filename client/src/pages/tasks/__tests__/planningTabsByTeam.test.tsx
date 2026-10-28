/**
 * Sprint and Schedule are alternative planning surfaces, never companions.
 *
 * A team that has sprint config plans work in the sprint, so the dated Schedule
 * view is not offered beside it. A team with no sprint config has no sprint to
 * put work in, so its dated view is the only place a due date means anything.
 * Backlog and Service Desk belong to both.
 *
 * The gate is the team's sprint config (`team_sprint_enabled`), not the sprint
 * list: `GET /tasks/available-sprints` materialises sprint rows as a side effect
 * of being read, so gating on the list made the tab set flicker.
 */
import React from "react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let AGILE = true;

vi.mock("../../../FeaturesContext", () => ({
    useFeatures: () => ({ hasFeature: () => AGILE }),
}));

vi.mock("../../../AuthContext", () => ({
    useAuth: () => ({
        user: { id: 1, role: "employee", team_id: 1, team_sprint_enabled: SPRINT_ENABLED },
    }),
}));

let SPRINT_ENABLED = true;

vi.mock("../../../api/tasks", () => ({
    getAvailableSprints: vi.fn().mockResolvedValue({ data: [] }),
}));

vi.mock("../../../api/organization", () => ({
    getOrgTeams: vi.fn().mockResolvedValue({ data: [] }),
}));

vi.mock("../TaskContext", () => ({
    useTaskCtx: () => ({
        assignableUsers: [],
        orgLabels: [],
        availableSprints: [],
        currentUser: { id: 1, team_id: 1, team_sprint_enabled: SPRINT_ENABLED },
    }),
}));

const TasksHeader = (await import("../TasksHeader")).default;

function renderHeader(sprintEnabled: boolean, agile = true) {
    SPRINT_ENABLED = sprintEnabled;
    AGILE = agile;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>
                <TasksHeader
                    activeTab="backlog"
                    setActiveTab={() => {}}
                    selectedSprintId={null}
                    setSelectedSprintId={() => {}}
                    backlogTasks={[]}
                    filterCount={0}
                    filtersOpen={false}
                    cardDensity="comfortable"
                    setCardDensity={() => {}}
                    setFiltersOpen={() => {}}
                    filterAssignee=""
                    setFilterAssignee={() => {}}
                    filterLabel=""
                    setFilterLabel={() => {}}
                    filterPriority=""
                    setFilterPriority={() => {}}
                    filterStatus=""
                    setFilterStatus={() => {}}
                    globalSearch=""
                    globalResults={[]}
                    globalSearching={false}
                    globalSearchOpen={false}
                    globalSearchRef={{ current: null } as unknown as React.RefObject<HTMLDivElement>}
                    onGlobalSearch={() => {}}
                    setGlobalSearchOpen={() => {}}
                    onOpenDetail={() => {}}
                    setBacklogFormOpen={() => {}}
                    setSprintImportOpen={() => {}}
                    fetchBacklog={() => {}}
                    clearFilters={() => {}}
                    sprintEnabled={sprintEnabled}
                />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe("planning tabs follow the team's sprint config", () => {
    beforeEach(() => {
        SPRINT_ENABLED = true;
    });

    test("a sprint team is offered Sprint, not Scheduled", () => {
        renderHeader(true);
        expect(screen.getByRole("button", { name: /Sprint/ })).toBeTruthy();
        expect(screen.queryByRole("button", { name: /Scheduled/ })).toBeNull();
        // The backlog is common to both surfaces.
        expect(screen.getByRole("button", { name: /Backlog/ })).toBeTruthy();
    });

    test("a team with no sprint config is offered Scheduled, not Sprint", () => {
        renderHeader(false);
        expect(screen.getByRole("button", { name: /Scheduled/ })).toBeTruthy();
        expect(screen.queryByRole("button", { name: /Sprint/ })).toBeNull();
        expect(screen.getByRole("button", { name: /Backlog/ })).toBeTruthy();
    });

    test("the Sprint tab does not wait for a sprint row to exist", () => {
        // availableSprints is [] in the mocked context: config alone is enough.
        renderHeader(true);
        expect(screen.getByRole("button", { name: /Sprint/ })).toBeTruthy();
    });

    test("agile off loses the Sprint tab whatever the team config says", () => {
        // Tasks.tsx derives the prop as `hasFeature("agile") && config`, so with
        // agile off the resolved value is false and the dated surface returns.
        renderHeader(false, false);
        expect(screen.queryByRole("button", { name: /Sprint/ })).toBeNull();
        expect(screen.getByRole("button", { name: /Scheduled/ })).toBeTruthy();
    });

});
