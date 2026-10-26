/**
 * The Sprint tab header names the team and numbers the sprint.
 *
 * Two things were wrong with the old header:
 *   1. It printed the literal word "Team" whenever the profile had no
 *      `team_name`, so every user saw "Team — Sprint 1" instead of their own
 *      team's name.
 *   2. It printed the sprint's stored `name` ("Sprint 1"), which duplicates the
 *      word "Sprint" already in the heading and hides the sprint number.
 *
 * The heading must read "<Team name> — #<n>", with the number taken from the
 * sprint's `sprint_number` (falling back to the trailing digits of its name).
 */
import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TasksHeader from "../TasksHeader";
import { TaskProvider } from "../TaskContext";
import { ToastProvider } from "../../../components/common/Toast";

const sprint = {
    id: 5,
    name: "Sprint 3",
    sprint_number: 3,
    status: "active",
    start_date: "2026-10-26",
    end_date: "2026-11-08",
    team_id: 1,
    auto_managed: true,
};

function renderHeader(currentUser: Record<string, unknown>) {
    return render(
        <MemoryRouter>
            <ToastProvider>
                <TaskProvider
                    assignableUsers={[]}
                    orgLabels={[]}
                    availableSprints={[sprint] as any}
                    availableProjects={[]}
                    currentUser={currentUser as any}
                    activeTab="sprint"
                >
                    <TasksHeader
                        activeTab="sprint"
                        setActiveTab={vi.fn()}
                        selectedSprintId={sprint.id}
                        setSelectedSprintId={vi.fn()}
                        backlogTasks={[]}
                        filterCount={0}
                        filtersOpen={false}
                        cardDensity="compact"
                        setCardDensity={vi.fn()}
                        setFiltersOpen={vi.fn()}
                        filterAssignee=""
                        setFilterAssignee={vi.fn()}
                        filterLabel=""
                        setFilterLabel={vi.fn()}
                        filterPriority=""
                        setFilterPriority={vi.fn()}
                        filterStatus=""
                        setFilterStatus={vi.fn()}
                        globalSearch=""
                        globalResults={[]}
                        globalSearching={false}
                        globalSearchOpen={false}
                        globalSearchRef={{ current: null } as any}
                        onGlobalSearch={vi.fn()}
                        setGlobalSearchOpen={vi.fn()}
                        onOpenDetail={vi.fn()}
                        setBacklogFormOpen={vi.fn()}
                        setSprintImportOpen={vi.fn()}
                        fetchBacklog={vi.fn()}
                        clearFilters={vi.fn()}
                    />
                </TaskProvider>
            </ToastProvider>
        </MemoryRouter>,
    );
}

describe("Sprint tab header", () => {
    test("names the user's team and numbers the sprint", () => {
        renderHeader({ id: 1, role: "employee", team_id: 1, team_name: "Payments" });

        const heading = screen.getByRole("heading", { level: 2 });
        expect(heading).toHaveTextContent("Payments — #3");
        expect(heading).not.toHaveTextContent("Team —");
        expect(heading).not.toHaveTextContent("Sprint 3");
    });

    test("falls back to the sprint number in the name when sprint_number is absent", () => {
        renderHeader({ id: 1, role: "employee", team_id: 1, team_name: "Payments" });

        const heading = screen.getByRole("heading", { level: 2 });
        expect(heading).toHaveTextContent("#3");
    });

    test("never prints the placeholder word Team", () => {
        renderHeader({ id: 1, role: "employee", team_id: 1 });

        const heading = screen.getByRole("heading", { level: 2 });
        expect(heading).not.toHaveTextContent("Team —");
    });
});
