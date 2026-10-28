/**
 * Team-owned tickets in the Plan UI.
 *
 * Only super admin and above get the team switcher (one team at a time,
 * defaulting to their own); a user without a team sees a persistent banner
 * instead of silently losing the Sprint tab.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state: {
    user: any;
    teamVisibility: boolean;
} = {
    user: { id: 1, team_id: 1, role: "employee", team_name: "Payments" },
    teamVisibility: true,
};

vi.mock("../BacklogTab", () => ({ default: () => <div data-testid="backlog-tab" /> }));
vi.mock("../TaskDetailModal", () => ({ default: () => null }));
vi.mock("../InlineCommentPanel", () => ({ default: () => null }));
vi.mock("../TasksOverlays", () => ({ default: () => null }));
vi.mock("../ScheduledTab", () => ({ default: () => null }));
vi.mock("../ServiceDeskTab", () => ({ default: () => null }));
vi.mock("../SprintTab", () => ({ default: () => null }));
vi.mock("../../components/common/ConfirmDialog", () => ({ default: () => null }));

vi.mock("../../../api/tasks", () => ({
    getTasks: vi.fn().mockResolvedValue({ data: { tasks: [], stats: {} } }),
    updateTaskStatus: vi.fn(),
    deleteTask: vi.fn(),
    carryForwardTasks: vi.fn().mockResolvedValue({ data: { carried: 0 } }),
    getAssignableUsers: vi.fn().mockResolvedValue({ data: [] }),
    getTaskLabels: vi.fn().mockResolvedValue({ data: [] }),
    addTaskComment: vi.fn(),
    updateTaskComment: vi.fn(),
    getTaskDetail: vi.fn(),
    getAvailableSprints: vi.fn().mockResolvedValue({
        data: [
            {
                id: 11, team_id: 1, name: "Payments Sprint 1", status: "active",
                start_date: "2026-10-01", end_date: "2026-10-14", team_name: "Payments",
            },
            {
                id: 21, team_id: 2, name: "Platform Sprint 1", status: "planned",
                start_date: "2026-10-15", end_date: "2026-10-28", team_name: "Platform",
            },
        ],
    }),
    getSprintStats: vi.fn().mockResolvedValue({ data: null }),
    getProjects: vi.fn().mockResolvedValue({ data: [] }),
    getBacklog: vi.fn().mockResolvedValue({
        data: { tasks: [], summary: { total: 0, byStatus: {}, byPriority: {} }, pagination: { total: 0 } },
    }),
    getEpics: vi.fn().mockResolvedValue({ data: { epics: [] } }),
    getTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
    updateTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
    getTaskHistory: vi.fn().mockResolvedValue({ data: [] }),
    getTaskComments: vi.fn().mockResolvedValue({ data: [] }),
    getTaskTimer: vi.fn().mockResolvedValue({ data: { running: false } }),
    getTaskCustomFieldValues: vi.fn().mockResolvedValue({ data: {} }),
    getTaskGitRefs: vi.fn().mockResolvedValue({ data: [] }),
    getScheduleOverlays: vi.fn().mockResolvedValue({ data: null }),
    scheduleTask: vi.fn(),
    unscheduleTask: vi.fn(),
    addBacklogTask: vi.fn(),
    assignTaskToSprint: vi.fn(),
    updateTask: vi.fn(),
    bulkTaskAction: vi.fn(),
    rankTask: vi.fn(),
    searchTasks: vi.fn().mockResolvedValue({ data: [] }),
    getTaskByKey: vi.fn(),
    getRecentVelocity: vi.fn().mockResolvedValue({ data: { sprints: [], average: 0 } }),
    getSprintBurndown: vi.fn().mockResolvedValue({ data: null }),
    getSprintBaseline: vi.fn().mockResolvedValue({ data: null }),
    getSprintScope: vi.fn().mockResolvedValue({ data: null }),
    updateSprintGoal: vi.fn(),
}));

vi.mock("../../../api/organization", () => ({
    getTeamSprintConfig: vi.fn().mockResolvedValue({ data: {} }),
    getOrgTeams: vi.fn().mockResolvedValue({
        data: [
            { id: 1, name: "Payments" },
            { id: 2, name: "Platform" },
        ],
    }),
    getTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
    updateTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
    getServiceDeskTickets: vi.fn().mockResolvedValue({ data: { tickets: [] } }),
    getServiceDeskStats: vi.fn().mockResolvedValue({ data: null }),
}));

vi.mock("../../../AuthContext", () => ({
    useAuth: () => ({ user: state.user }),
    hasTenantContext: () => true,
}));

vi.mock("../../../FeaturesContext", () => ({
    useFeatures: () => ({
        hasFeature: (name: string) => name === "team_visibility"
            ? state.teamVisibility
            : true,
        features: {},
        plan: "enterprise",
    }),
}));

vi.mock("../../../AgileConfigContext", () => ({
    useAgileConfig: () => ({
        workflowStates: [],
        typeById: {},
        unitLabel: "pts",
        features: {},
        initialState: { key: "pending" },
        terminalStates: [{ key: "done" }],
    }),
}));

vi.mock("../../../CustomFieldsContext", () => ({
    useCustomFields: () => ({ fields: [] }),
}));

vi.mock("../../../components/common/Toast", () => ({
    useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
    ToastProvider: ({ children }: any) => children,
}));

import Tasks from "../../Tasks";

function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={["/tasks/backlog"]}>
                <Tasks />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    state.user = { id: 1, team_id: 1, role: "employee", team_name: "Payments" };
    state.teamVisibility = true;
});

describe("Plan team visibility", () => {
    test("a super admin gets a one-team switcher defaulted to their own team", async () => {
        state.user = { id: 2, team_id: 1, role: "super_admin", team_name: "Payments" };
        renderPage();

        const switcher = await screen.findByLabelText("Team");
        expect(switcher).toBeInTheDocument();
        // The default is applied once the team list resolves.
        await waitFor(() =>
            expect((switcher as HTMLSelectElement).value).toBe("1"),
        );
        // One team at a time: there is no merged "All teams" board.
        expect(screen.queryByRole("option", { name: "All teams" })).not.toBeInTheDocument();
        expect(screen.getByRole("option", { name: "Unassigned" })).toBeInTheDocument();
        expect(screen.getByRole("option", { name: "Platform" })).toBeInTheDocument();
    });

    test("a non-admin never sees the team switcher", () => {
        renderPage();
        expect(screen.queryByLabelText("Team")).not.toBeInTheDocument();
    });

    test("an HR admin is below super admin and gets no switcher", () => {
        state.user = { id: 2, team_id: 1, role: "hr_admin", team_name: "Payments" };
        renderPage();
        expect(screen.queryByLabelText("Team")).not.toBeInTheDocument();
    });

    test("the switcher does not depend on the team_visibility flag", async () => {
        state.user = { id: 2, team_id: 1, role: "platform_admin", team_name: "Payments" };
        state.teamVisibility = false;
        renderPage();
        expect(await screen.findByLabelText("Team")).toBeInTheDocument();
    });

    test("a user without a team sees the explanatory banner", async () => {
        state.user = { id: 3, team_id: null, role: "employee", team_name: null };
        renderPage();
        expect(await screen.findByRole("status")).toHaveTextContent(
            /not assigned to a team/i,
        );
    });

    test("a team member does not see the banner", () => {
        renderPage();
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
});
