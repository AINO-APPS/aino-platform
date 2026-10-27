/**
 * A ticket is in a sprint or in the backlog — never both.
 *
 * Plan view renders the backlog pane and the sprint pane side by side from two
 * different sources (`useBacklog`'s GET /tasks/backlog and `fetchTasks`'s GET
 * /tasks?sprint_id=…). Once a ticket joins the sprint, the backlog pane must
 * reload so the row leaves it; otherwise the same ticket shows in both lists.
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const getBacklog = vi.fn();
const getTasks = vi.fn();
const assignTaskToSprint = vi.fn();
const showConfirm = vi.fn();

vi.mock("../../../api/tasks", () => ({
    getTasks: (...a: unknown[]) => getTasks(...a),
    getBacklog: (...a: unknown[]) => getBacklog(...a),
    assignTaskToSprint: (...a: unknown[]) => assignTaskToSprint(...a),
    updateTaskStatus: vi.fn(),
    deleteTask: vi.fn(),
    carryForwardTasks: vi.fn().mockResolvedValue({ data: { carried: 0 } }),
    getAssignableUsers: vi.fn().mockResolvedValue({ data: [] }),
    getTaskLabels: vi.fn().mockResolvedValue({ data: [] }),
    addTaskComment: vi.fn(),
    updateTaskComment: vi.fn(),
    deleteTaskComment: vi.fn(),
    getTaskDetail: vi.fn().mockResolvedValue({ data: {} }),
    getAvailableSprints: vi.fn(),
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
    updateTask: vi.fn(),
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
        // Auto-confirm: the loop is about list membership, not the dialog.
        showConfirm: (_t: string, _m: string, onConfirm: () => void) => {
            showConfirm();
            onConfirm();
        },
        closeConfirm: vi.fn(),
        cancelConfirm: vi.fn(),
    }),
}));

import Tasks from "../../Tasks";

const TICKET = { id: 7, title: "Refund webhook retries", issue_key: "PAY-142", priority: "high", workflow_state_key: "pending" };

/** The server state: one ticket, in or out of the sprint. */
let sprintIdOfTicket: number | null = null;

function page() {
  return { tasks: [{ ...TICKET }], summary: { total: 1, byStatus: {}, byPriority: {} }, pagination: { total: 1 }, completed_count: 0 };
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

/** How many panes currently render this ticket, by title. */
function occurrences(): number {
    return screen.queryAllByText(TICKET.title).length;
}

beforeEach(() => {
    sprintIdOfTicket = null;
    showConfirm.mockReset();

    getTasks.mockReset().mockImplementation(async () => ({
        data: {
            tasks: sprintIdOfTicket === null ? [] : [{ ...TICKET, sprint_id: sprintIdOfTicket }],
            stats: { total: 0, done: 0, inProgress: 0, percent: 0 },
        },
    }));

    // Real server rule: the backlog only contains sprint_id IS NULL.
    getBacklog.mockReset().mockImplementation(async () => ({
        data: sprintIdOfTicket === null ? page() : { ...page(), tasks: [], pagination: { total: 0 }, summary: { total: 0, byStatus: {}, byPriority: {} } },
    }));

    assignTaskToSprint.mockReset().mockImplementation(async () => {
        sprintIdOfTicket = 1;
        return { data: {} };
    });
});

describe("sprint membership is exclusive", () => {
    test("a ticket moved into the sprint leaves the backlog pane", async () => {
        renderPage();

        // The ticket starts in the backlog pane, and only there.
        await waitFor(() => expect(occurrences()).toBe(1));

        fireEvent.click(screen.getByRole("button", { name: /Move .* into the sprint/i }));

        await waitFor(() => expect(assignTaskToSprint).toHaveBeenCalled());
        await waitFor(() => expect(sprintIdOfTicket).toBe(1));

        // It must now be in the sprint pane, and no longer in the backlog pane.
        await waitFor(() => expect(occurrences()).toBe(1));
        expect(getBacklog.mock.calls.length).toBeGreaterThan(1);
    });
});
