/**
 * The Sprint tab header names the selected project and numbers the sprint.
 *
 * The heading must read "<Project name> — #<n>", with the number taken from the
 * sprint's `sprint_number` (falling back to the trailing digits of its name),
 * never the sprint's stored `name`, which repeats the word "Sprint".
 */
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

function renderHeader(
    currentUser: Record<string, unknown>,
    selectedSprintId: number | null = sprint.id,
    currentSprintId: number | null = sprint.id,
    scopeProps: Record<string, any> = {},
) {
    return render(
        <MemoryRouter>
            <ToastProvider>
                <TaskProvider
                    assignableUsers={[]}
                    orgLabels={[]}
                    availableSprints={[sprint] as any}
                    currentSprintId={currentSprintId}
                    availableProjects={[]}
                    currentUser={currentUser as any}
                    activeTab="sprint"
                >
                    <TasksHeader
                        activeTab="sprint"
                        setActiveTab={vi.fn()}
                        selectedSprintId={selectedSprintId}
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
                        {...scopeProps}
                    />
                </TaskProvider>
            </ToastProvider>
        </MemoryRouter>,
    );
}

describe("Sprint tab header", () => {
    test("the project switcher lists accessible projects and offers no Team or Unassigned choice", () => {
        const change = vi.fn();
        renderHeader({ id: 1 }, sprint.id, sprint.id, {
            projects: [{ id: 10, key: "ONE", name: "One" }, { id: 20, key: "TWO", name: "Two" }],
            selectedProjectId: 10,
            onProjectChange: change,
        });
        const picker = screen.getByRole("combobox", { name: "Project" });
        expect(picker).toHaveTextContent("ONE — One");
        expect(picker).toHaveTextContent("TWO — Two");
        expect(screen.queryByRole("combobox", { name: "Team" })).not.toBeInTheDocument();
        expect(screen.queryByRole("option", { name: "Unassigned" })).not.toBeInTheDocument();
        fireEvent.change(picker, { target: { value: "20" } });
        expect(change).toHaveBeenCalledWith(20);
        expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("One");
    });

    const payments = { projects: [{ id: 10, key: "PAY", name: "Payments" }], selectedProjectId: 10 };

    test("names the selected project and numbers the sprint", () => {
        renderHeader({ id: 1, role: "employee" }, sprint.id, sprint.id, payments);

        const heading = screen.getByRole("heading", { level: 2 });
        expect(heading).toHaveTextContent("Payments — #3");
        expect(heading).not.toHaveTextContent("Sprint 3");
    });

    test("falls back to the sprint number in the name when sprint_number is absent", () => {
        renderHeader({ id: 1, role: "employee" }, sprint.id, sprint.id, payments);

        expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("#3");
    });

    test("never prints the placeholder word Team", () => {
        renderHeader({ id: 1, role: "employee" }, sprint.id, sprint.id, payments);

        expect(screen.getByRole("heading", { level: 2 })).not.toHaveTextContent("Team —");
    });

    test("uses currentSprintId while the selected sprint is not initialized", () => {
        renderHeader({ id: 1, role: "employee" }, null, sprint.id, payments);

        expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Payments — #3");
    });
});
