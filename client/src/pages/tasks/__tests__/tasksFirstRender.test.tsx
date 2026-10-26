/**
 * The first render is decided by the URL, not by an effect afterwards.
 *
 * Opening a sprint, the plan or the schedule directly used to mount the page as
 * the backlog and only then correct itself: the user saw the wrong view flash,
 * and the backlog request was fired for a page that never showed it. Route
 * state must be known before the first render so a deep link loads exactly what
 * it names.
 */
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../../AuthContext", () => ({
    AuthProvider: ({ children }: { children: ReactNode }) => children,
    useAuth: () => ({
        isAuthenticated: true,
        user: { id: 1, tenant_id: 1, team_id: 1, role: "employee" },
    }),
    hasTenantContext: () => true,
}));
vi.mock("../../../FeaturesContext", () => ({
    FeaturesProvider: ({ children }: { children: ReactNode }) => children,
    useFeatures: () => ({ hasFeature: () => true, features: {}, plan: "standard" }),
}));
vi.mock("../../../AgileConfigContext", () => ({
    AgileConfigProvider: ({ children }: { children: ReactNode }) => children,
    useAgileConfig: () => ({
        workflowStates: [],
        typeById: {},
        unitLabel: "pts",
        features: {},
        initialState: { key: "pending" },
        terminalStates: [{ key: "done" }],
    }),
}));
vi.mock("../../../components/common/Toast", () => ({
    ToastProvider: ({ children }: { children: ReactNode }) => children,
    useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("../../../api/client", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getLocalToday: () => "2026-10-27",
}));

// Tab bodies are fixtures that expose the props the page hands them, so the
// assertion is about which view the page chose — not about the tab's own work.
vi.mock("../BacklogTab", () => ({ default: () => <div data-testid="backlog-tab" /> }));
vi.mock("../ScheduledTab", () => ({ default: () => <div data-testid="scheduled-tab" /> }));
vi.mock("../ServiceDeskTab", () => ({ default: () => <div data-testid="service-desk-tab" /> }));
vi.mock("../SprintTab", () => ({
    default: (props: any) => (
        <div
            data-testid="sprint-tab"
            data-plan={String(props.plan)}
            data-sprint={String(props.selectedSprintId)}
        />
    ),
}));
vi.mock("../TaskDetailModal", () => ({ default: () => null }));
vi.mock("../InlineCommentPanel", () => ({ default: () => null }));
vi.mock("../TasksOverlays", () => ({ default: () => null }));

vi.mock("../../../api/tasks", () => ({
    getTasks: vi.fn().mockResolvedValue({ data: { tasks: [], stats: {} } }),
    getBacklog: vi.fn().mockResolvedValue({ data: {
        tasks: [], summary: { total: 0, byStatus: {}, byPriority: {} }, pagination: { total: 0 },
    } }),
    getSprintStats: vi.fn().mockResolvedValue({ data: null }),
    getAvailableSprints: vi.fn().mockResolvedValue({ data: [{
        id: 12, status: "active", name: "Sprint 12",
        start_date: "2026-10-20", end_date: "2026-11-02",
    }] }),
    getAssignableUsers: vi.fn().mockResolvedValue({ data: [] }),
    getTaskLabels: vi.fn().mockResolvedValue({ data: [] }),
    getProjects: vi.fn().mockResolvedValue({ data: [] }),
    getEpics: vi.fn().mockResolvedValue({ data: { epics: [] } }),
    carryForwardTasks: vi.fn().mockResolvedValue({ data: { carried: 0 } }),
    getRecentVelocity: vi.fn().mockResolvedValue({ data: { sprints: [], average: 0 } }),
    getSprintBurndown: vi.fn().mockResolvedValue({ data: [] }),
    getSprintBaseline: vi.fn().mockResolvedValue({ data: {} }),
    getTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
    updateTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
    getTaskDetail: vi.fn(), getTaskByKey: vi.fn(),
}));
vi.mock("../../../api/organization", () => ({
    getTeamSprintConfig: vi.fn().mockResolvedValue({ data: {} }),
    getTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
    updateTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
}));

import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Tasks from "../../Tasks";
import { getAvailableSprints, getBacklog, getTasks } from "../../../api/tasks";

function renderAt(path: string) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return render(
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={[path]}>
                <Routes>
                    <Route path="/tasks/*" element={<Tasks />} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe("Tasks first render from the URL", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // A server render runs no effects, so it observes the first commit exactly.
    // If the view were still hard-coded to the backlog and corrected by an
    // effect, this HTML would contain the backlog tab.
    test.each([
        ["/tasks/sprint/12", "sprint-tab"],
        ["/tasks/sprint/12/plan", "sprint-tab"],
        ["/tasks/schedule", "scheduled-tab"],
        ["/tasks/desk", "service-desk-tab"],
        ["/tasks/backlog", "backlog-tab"],
    ])("%s names its view in the very first render, before effects", (path, tabId) => {
        const html = renderToString(
            <QueryClientProvider client={new QueryClient()}>
                <MemoryRouter initialEntries={[path]}>
                    <Routes>
                        <Route path="/tasks/*" element={<Tasks />} />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>,
        );

        expect(html).toContain(`data-testid="${tabId}"`);
        if (tabId !== "backlog-tab") {
            expect(html).not.toContain('data-testid="backlog-tab"');
        }
    });

    test.each([
        ["/tasks/sprint/12", "sprint-tab"],
        ["/tasks/sprint/12/plan", "sprint-tab"],
        ["/tasks/schedule", "scheduled-tab"],
        ["/tasks/desk", "service-desk-tab"],
        ["/tasks/backlog", "backlog-tab"],
    ])("%s opens its own view", (path, tabId) => {
        renderAt(path);

        expect(screen.getByTestId(tabId)).toBeTruthy();
        if (tabId !== "backlog-tab") {
            expect(screen.queryByTestId("backlog-tab")).toBeNull();
        }
    });

    test("the board deep link never requests the backlog it is not showing", async () => {
        renderAt("/tasks/sprint/12");

        await waitFor(() => expect(getTasks).toHaveBeenCalled());
        expect(getBacklog).not.toHaveBeenCalled();
    });

    test("the plan deep link loads the backlog pane it does show", async () => {
        renderAt("/tasks/sprint/12/plan");

        await waitFor(() => expect(getBacklog).toHaveBeenCalledTimes(1));
        expect(screen.queryByTestId("backlog-tab")).toBeNull();
    });

    test("/tasks/schedule requests neither the backlog nor a sprint", async () => {
        renderAt("/tasks/schedule");

        await waitFor(() => expect(getAvailableSprints).toHaveBeenCalled());
        expect(getBacklog).not.toHaveBeenCalled();
        expect(getTasks).not.toHaveBeenCalled();
    });

    test("a legacy ?tab= link does not request the backlog it redirects away from", async () => {
        renderAt("/tasks?tab=scheduled&priority=high");

        await waitFor(() => expect(screen.getByTestId("scheduled-tab")).toBeTruthy());
        expect(getBacklog).not.toHaveBeenCalled();
    });

    test("a sprint deep link loads that sprint, not whichever is active", async () => {
        renderAt("/tasks/sprint/12/plan");

        await waitFor(() =>
            expect(getTasks).toHaveBeenCalledWith(
                undefined,
                expect.objectContaining({ sprint_id: 12 }),
                expect.anything(),
            ),
        );
        expect(screen.getByTestId("sprint-tab").dataset.plan).toBe("true");
        expect(screen.getByTestId("sprint-tab").dataset.sprint).toBe("12");
    });

    test("the board route derives the board, the plan route the plan", () => {
        renderAt("/tasks/sprint/12");
        expect(screen.getByTestId("sprint-tab").dataset.plan).toBe("false");
    });
});
