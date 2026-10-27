/**
 * Editing a ticket's sprint from the detail panel, on the Plan view, must
 * refresh the backlog pane too.
 *
 * The Plan view renders the backlog and the sprint side by side while
 * `activeTab` is "sprint". Changing sprint membership from the detail panel
 * moves the ticket between the two panes, so both lists have to reload —
 * refreshing only the sprint list leaves the ticket visible in both.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const getBacklog = vi.fn();
const getTasks = vi.fn();
const updateTask = vi.fn();
const getTaskDetail = vi.fn();
const showConfirm = vi.fn();

vi.mock("../../../api/tasks", () => ({
    getTasks: (...a: unknown[]) => getTasks(...a),
    getBacklog: (...a: unknown[]) => getBacklog(...a),
    updateTask: (...a: unknown[]) => updateTask(...a),
    getTaskDetail: (...a: unknown[]) => getTaskDetail(...a),
    assignTaskToSprint: vi.fn(),
    updateTaskStatus: vi.fn(),
    deleteTask: vi.fn(),
    carryForwardTasks: vi.fn().mockResolvedValue({ data: { carried: 0 } }),
    getAssignableUsers: vi.fn().mockResolvedValue({ data: [{ id: 1, username: "alice", full_name: "Alice" }] }),
    getTaskLabels: vi.fn().mockResolvedValue({ data: [] }),
    addTaskComment: vi.fn(),
    updateTaskComment: vi.fn(),
    deleteTaskComment: vi.fn(),
    getAvailableSprints: vi.fn().mockResolvedValue({
        data: [{ id: 1, name: "Sprint 1", start_date: "2026-10-20", end_date: "2026-11-02", status: "active" }],
    }),
    getSprintStats: vi.fn().mockResolvedValue({ data: null }),
    getProjects: vi.fn().mockResolvedValue({ data: [] }),
    getEpics: vi.fn().mockResolvedValue({ data: { epics: [] } }),
    getTaskHistory: vi.fn().mockResolvedValue({ data: [] }),
    getTaskComments: vi.fn().mockResolvedValue({ data: [] }),
    getTaskTimer: vi.fn().mockResolvedValue({ data: { running: false } }),
    getTaskCustomFieldValues: vi.fn().mockResolvedValue({ data: {} }),
    getTaskGitRefs: vi.fn().mockResolvedValue({ data: [] }),
    getScheduleOverlays: vi.fn().mockResolvedValue({ data: null }),
    scheduleTask: vi.fn(),
    unscheduleTask: vi.fn(),
    addBacklogTask: vi.fn(),
    bulkTaskAction: vi.fn(),
    rankTask: vi.fn(),
    searchTasks: vi.fn().mockResolvedValue({ data: [] }),
    getTaskByKey: vi.fn(),
    getRecentVelocity: vi.fn().mockResolvedValue({ data: { sprints: [], average: 0 } }),
    getSprintBurndown: vi.fn().mockResolvedValue({ data: null }),
    getSprintScope: vi.fn().mockResolvedValue({ data: null }),
    getSprintBaseline: vi.fn().mockResolvedValue({ data: null }),
    updateSprint: vi.fn(),
    updateSprintGoal: vi.fn(),
    getAcceptanceCriteria: vi.fn().mockResolvedValue({ data: { criteria: [] } }),
    addAcceptanceCriterion: vi.fn().mockResolvedValue({ data: {} }),
    updateAcceptanceCriterion: vi.fn().mockResolvedValue({ data: {} }),
    deleteAcceptanceCriterion: vi.fn().mockResolvedValue({ data: {} }),
    getTaskDependencies: vi.fn().mockResolvedValue({ data: [] }),
    addTaskDependency: vi.fn().mockResolvedValue({ data: {} }),
    removeTaskDependency: vi.fn().mockResolvedValue({ data: {} }),
    getTaskChildren: vi.fn().mockResolvedValue({ data: [] }),
    getTaskTimeEntries: vi.fn().mockResolvedValue({ data: [] }),
}));

vi.mock("../../../api/organization", () => ({
    getTeamSprintConfig: vi.fn().mockResolvedValue({ data: {} }),
    getTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
    updateTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
    getServiceDeskTickets: vi.fn().mockResolvedValue({ data: { tickets: [] } }),
    getServiceDeskStats: vi.fn().mockResolvedValue({ data: null }),
}));

vi.mock("../../../hooks/useRealtimeEvent", () => ({ default: vi.fn() }));
vi.mock("../hooks/useVisiblePoll", () => ({ useVisiblePoll: vi.fn() }));

vi.mock("../../../AuthContext", () => ({
    useAuth: () => ({ user: { id: 1, team_id: 1, role: "employee" } }),
    hasTenantContext: () => true,
}));

vi.mock("../../../FeaturesContext", () => ({
    useFeatures: () => ({ hasFeature: () => true, features: {}, plan: "standard" }),
}));

vi.mock("../../../AgileConfigContext", () => ({
    useAgileConfig: () => ({
        workflowStates: [{ id: 1, key: "pending", label: "To do", category: "open" }],
        typeById: {},
        workItemTypes: [],
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

vi.mock("../hooks/useConfirmDialog", () => ({
    useConfirmDialog: () => ({
        confirmDialog: { open: false, title: "", message: "" },
        showConfirm: (_t: string, _m: string, onConfirm: () => void) => {
            showConfirm();
            onConfirm();
        },
        closeConfirm: vi.fn(),
        cancelConfirm: vi.fn(),
    }),
}));

import Tasks from "../../Tasks";

const TICKET = {
    id: 7,
    title: "Refund webhook retries",
    issue_key: "PAY-142",
    priority: "high",
    workflow_state_key: "pending",
    story_points: 3,
};

/** Server state: the ticket's sprint membership. */
let sprintIdOfTicket: number | null = null;

function backlogResult() {
    const tasks = sprintIdOfTicket === null ? [{ ...TICKET }] : [];
    return {
        data: {
            tasks,
            summary: { total: tasks.length, byStatus: {}, byPriority: {} },
            pagination: { total: tasks.length },
            completed_count: 0,
        },
    };
}

function sprintResult() {
    const tasks = sprintIdOfTicket === null ? [] : [{ ...TICKET, sprint_id: sprintIdOfTicket }];
    return { data: { tasks, stats: { total: tasks.length, done: 0, inProgress: 0, percent: 0 } } };
}

function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={["/tasks/sprint/1/plan"]}>
                <Tasks />
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    sprintIdOfTicket = null;
    showConfirm.mockReset();

    getBacklog.mockReset().mockImplementation(async () => backlogResult());
    getTasks.mockReset().mockImplementation(async () => sprintResult());
    getTaskDetail.mockReset().mockImplementation(async () => ({
        data: { ...TICKET, sprint_id: sprintIdOfTicket, comments: [] },
    }));
    updateTask.mockReset().mockImplementation(async (_id: unknown, patch: any) => {
        if (patch?.sprint_id !== undefined) {
            sprintIdOfTicket = patch.sprint_id === null || patch.sprint_id === "" ? null : Number(patch.sprint_id);
        }
        return { data: {} };
    });
});

describe("sprint membership from the detail panel on the Plan view", () => {
    test("moving a ticket into a sprint refreshes the backlog pane too", async () => {
        renderPage();

        // The ticket starts in the backlog pane only.
        await waitFor(() => expect(screen.getAllByText(TICKET.title)).toHaveLength(1));

        // Open it from the backlog pane.
        fireEvent.click(screen.getAllByText(TICKET.title)[0]);
        await waitFor(() => expect(getTaskDetail).toHaveBeenCalled());

        // Enter edit mode and choose the sprint.
        fireEvent.click(await screen.findByRole("button", { name: /^Edit/i }));
        const sprintPicker = (await screen.findAllByRole("combobox")).find((el) =>
            within(el).queryByRole("option", { name: /Sprint 1/ }),
        );
        expect(sprintPicker).toBeTruthy();
        fireEvent.change(sprintPicker!, { target: { value: "1" } });
        fireEvent.click(screen.getByRole("button", { name: /^Save/i }));

        await waitFor(() => expect(updateTask).toHaveBeenCalled(), { timeout: 5000 });
        await waitFor(() => expect(sprintIdOfTicket).toBe(1), { timeout: 5000 });

        // The backlog must have been reloaded after the move, not just the sprint.
        await waitFor(() => expect(getBacklog.mock.calls.length).toBeGreaterThan(1), { timeout: 5000 });

        // And the ticket appears in exactly one pane — the sprint, not both.
        await waitFor(() => {
            const backlogPane = screen.getByRole("region", { name: "Backlog" });
            expect(within(backlogPane).queryByText(TICKET.title)).toBeNull();
        }, { timeout: 5000 });
        const sprintPane = screen.getByRole("region", { name: "Sprint" });
        expect(within(sprintPane).getByText(TICKET.title)).toBeTruthy();
    });
});
