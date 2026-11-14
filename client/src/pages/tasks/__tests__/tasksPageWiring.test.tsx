/**
 * The Tasks page must hand every handler the Backlog tab renders.
 *
 * `Tasks.tsx` spreads the `useBacklog` result into `<BacklogTab>` and adds a
 * few handlers by hand. The tab expects `onToggleCompleted`, `onShowAllCompleted` and
 * `onHandleAddBacklog`. When those names drift apart the tab still renders —
 * the handlers are simply `undefined` — and every click throws
 * "… is not a function".
 *
 * This test renders the real page and inspects the props it passes, so a
 * missing or misnamed handler fails here instead of in the browser.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getTasks } from "../../../api/tasks";

const captured: { props: Record<string, any> | null } = { props: null };
const scope = vi.hoisted(() => ({ projects: [] as any[] }));

vi.mock("../BacklogTab", () => ({
    default: (props: Record<string, any>) => {
        captured.props = props;
        return <div data-testid="backlog-tab" />;
    },
}));

vi.mock("../TasksHeader", () => ({ default: () => <div /> }));
vi.mock("../TaskDetailModal", () => ({ default: () => null }));
vi.mock("../InlineCommentPanel", () => ({ default: () => null }));
vi.mock("../TasksOverlays", () => ({ default: () => null }));
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
    getAvailableSprints: vi.fn().mockResolvedValue({ data: [] }),
    getSprintStats: vi.fn().mockResolvedValue({ data: null }),
    getProjects: vi.fn(async () => ({ data: scope.projects })),
    getMyProjects: vi.fn(async () => ({ data: scope.projects })),
    getSprints: vi.fn().mockResolvedValue({ data: { sprints: [], currentSprintId: null } }),
    getBacklog: vi.fn().mockResolvedValue({
        data: { tasks: [], summary: { total: 0, byStatus: {}, byPriority: {} }, pagination: { total: 0 } },
    }),
    getEpics: vi.fn().mockResolvedValue({ data: { epics: [] } }),
    getTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
    updateTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
    getTaskHistory: vi.fn().mockResolvedValue({ data: [] }),
    getTaskComments: vi.fn().mockResolvedValue({ data: [] }),
    getTaskWorklogs: vi.fn().mockResolvedValue({ data: { worklogs: [], time_spent_minutes: 0 } }),
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
    getSprintScope: vi.fn().mockResolvedValue({ data: null }),
    updateSprintGoal: vi.fn(),
}));

vi.mock("../../../api/organization", () => ({
    getTeamSprintConfig: vi.fn().mockResolvedValue({ data: {} }),
    getTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
    updateTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
    getServiceDeskTickets: vi.fn().mockResolvedValue({ data: { tickets: [] } }),
    getServiceDeskStats: vi.fn().mockResolvedValue({ data: null }),
}));

vi.mock("../../../AuthContext", () => ({
    useAuth: () => ({ user: { id: 1, team_id: 1, role: "employee" } }),
    hasTenantContext: () => true,
}));

vi.mock("../../../FeaturesContext", () => ({
    useFeatures: () => ({ hasFeature: () => true, features: {}, plan: "standard" }),
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

function renderPage(path = "/tasks/backlog") {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[path]}>
                <Tasks />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe("Tasks page → Backlog tab wiring", () => {
    beforeEach(() => {
        captured.props = null;
        scope.projects = [{ id: 10, key: "ONE", name: "One", hasSprints: true, planTabs: ["backlog", "sprint", "reports"] }];
    });

    test("every handler the backlog tab renders is supplied", async () => {
        renderPage();
        await screen.findByTestId("backlog-tab");
        await waitFor(() => expect(captured.props).not.toBeNull());

        const props = captured.props!;
        for (const name of [
            "onAddToSprint",
            "onToggleCompleted",
            "onShowAllCompleted",
            "onHandleAddBacklog",
            "onOpenDetail",
            "onQuickAdd",
            "onInlineEdit",
            "onHandleSummaryTotal",
            "onHandleSummaryPriority",
            "onToggleLabel",
        ]) {
            expect(typeof props[name], `${name} must be a function`).toBe("function");
        }
    });

    test.each([["list", "Project task list"], ["calendar", "Project calendar"]])("Task list %s route renders its real project-scoped surface", async (view, name) => {
        scope.projects = [{ id: 10, name: "Operations", key: "OPS", type: "task_list", hasSprints: false, planTabs: ["list", "board", "calendar"] }];
        renderPage(`/tasks/${view}`);
        expect(await screen.findByRole("region", { name }, { timeout: 10_000 })).toBeInTheDocument();
        await waitFor(() => expect(getTasks).toHaveBeenCalledWith(undefined,
            expect.objectContaining({ scope: view, project_id: 10 }), expect.anything()));
    });
});
