import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { getTaskByKey } from "../api/tasks";

const auth = vi.hoisted(() => ({ isAuthenticated: true, mustChangePassword: false }));

vi.mock("../AuthContext", () => ({
    AuthProvider: ({ children }: { children: ReactNode }) => children,
    useAuth: () => ({
        isAuthenticated: auth.isAuthenticated,
        isInitializing: false,
        user: {
            id: 1, tenant_id: 1, org_id: 1, team_id: 1, role: "employee",
            must_change_password: auth.mustChangePassword,
            project_ownership: true,
        },
    }),
    hasTenantContext: () => true,
    isTenantlessPlatformAdmin: () => false,
    platformConsoleRouteRedirect: () => null,
    currentRealm: () => "tenant",
    realmHomePath: () => "/",
}));
vi.mock("../FeaturesContext", () => ({
    FeaturesProvider: ({ children }: { children: ReactNode }) => children,
    useFeatures: () => ({ hasFeature: () => true, features: {}, plan: "standard" }),
}));
vi.mock("../AgileConfigContext", () => ({
    AgileConfigProvider: ({ children }: { children: ReactNode }) => children,
    useAgileConfig: () => ({
        workflowStates: [], typeById: {}, unitLabel: "pts", features: {},
        initialState: { key: "pending" }, terminalStates: [{ key: "done" }],
    }),
}));
vi.mock("../CustomFieldsContext", () => ({
    CustomFieldsProvider: ({ children }: { children: ReactNode }) => children,
    useCustomFields: () => ({ fields: [] }),
}));
vi.mock("../ThemeContext", () => ({ ThemeProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("../WorkStateContext", () => ({ WorkStateProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("../ChatContext", () => ({ ChatProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("../CallContext", () => ({ CallProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("../MeetingContext", () => ({ MeetingProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("../status/StatusContext", () => ({ StatusProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("../NotificationPrefsContext", () => ({ NotificationPrefsProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("../BrandingContext", () => ({ BrandingProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("../RoleLabelsContext", () => ({ RoleLabelsProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("../hooks/useApprovalSync", () => ({ default: () => {} }));
vi.mock("@tanstack/react-query-persist-client", async () => {
    const { QueryClientProvider } = await import("@tanstack/react-query");
    return { PersistQueryClientProvider: ({ children, client }: any) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
});
vi.mock("../queryClient", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    return {
        queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
        queryPersister: {}, QUERY_PERSIST_MAX_AGE: 0,
    };
});
vi.mock("../components/common/Toast", () => ({
    ToastProvider: ({ children }: { children: ReactNode }) => children,
    useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("../components/common/AxiosInterceptor", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("../components/navbar/Navbar", () => ({ default: () => null }));
vi.mock("../components/meeting/MeetingPiP", () => ({ default: () => null }));
vi.mock("../components/meeting/GlobalMeetingRoom", () => ({ default: () => null }));
vi.mock("../components/notifications/GlobalIncomingCall", () => ({ default: () => null }));
vi.mock("../components/notifications/GlobalMeetingNotification", () => ({ default: () => null }));
vi.mock("../components/notifications/GlobalMessageNotifications", () => ({ default: () => null }));
vi.mock("../components/common/ImpersonationBanner", () => ({ default: () => null }));
vi.mock("../components/common/ElectronTitleBar", () => ({ default: () => null }));
vi.mock("../components/common/UpdateNotification", () => ({ default: () => null }));
vi.mock("../components/common/InspectorSessionBanner", () => ({ default: () => null }));
vi.mock("../components/common/ScreenPicker", () => ({ default: () => null }));
vi.mock("../components/attendance/WorkModeChangeDialog", () => ({ default: () => null }));
vi.mock("../pages/Login", () => ({ default: () => <h1>Login</h1> }));
vi.mock("../pages/ChangePassword", () => ({ default: () => <h1>Change password</h1> }));
vi.mock("../pages/ForgotPassword", () => ({ default: () => null }));
vi.mock("../pages/ResetPassword", () => ({ default: () => null }));
vi.mock("../pages/RealmHandoff", () => ({ default: () => null }));
vi.mock("../pages/Dashboard", () => ({ default: () => <h1>Dashboard</h1> }));

// Keep the real App, KeepAlive, Tasks, header and route hooks. Only the tab
// contents and unrelated authenticated shell are replaced with small fixtures.
vi.mock("../pages/tasks/BacklogTab", () => ({ default: () => <div data-testid="backlog-tab" /> }));
vi.mock("../pages/tasks/ScheduledTab", () => ({ default: () => <div data-testid="scheduled-tab" /> }));
vi.mock("../pages/tasks/ServiceDeskTab", () => ({ default: () => <div data-testid="service-desk-tab" /> }));
vi.mock("../pages/tasks/SprintTab", () => ({ default: () => <div data-testid="sprint-tab" /> }));
vi.mock("../pages/SprintInsights", () => ({ default: () => <div data-testid="reports-tab" /> }));
vi.mock("../pages/tasks/TaskDetailModal", () => ({ default: () => null }));
vi.mock("../pages/tasks/InlineCommentPanel", () => ({ default: () => null }));
vi.mock("../pages/tasks/TasksOverlays", () => ({ default: () => null }));

vi.mock("../api/tasks", () => ({
    getTasks: vi.fn().mockResolvedValue({ data: { tasks: [], stats: {} } }),
    updateTaskStatus: vi.fn(), deleteTask: vi.fn(),
    carryForwardTasks: vi.fn().mockResolvedValue({ data: { carried: 0 } }),
    getAssignableUsers: vi.fn().mockResolvedValue({ data: [] }),
    getTaskLabels: vi.fn().mockResolvedValue({ data: [] }),
    addTaskComment: vi.fn(), updateTaskComment: vi.fn(), getTaskDetail: vi.fn(),
    getAvailableSprints: vi.fn().mockResolvedValue({ data: [] }),
    getSprintStats: vi.fn().mockResolvedValue({ data: null }),
    getProjects: vi.fn().mockResolvedValue({ data: [{ id: 10, key: "ONE", name: "One", hasSprints: true, planTabs: ["backlog", "sprint", "reports"] }] }),
    getMyProjects: vi.fn().mockResolvedValue({ data: [] }),
    getSprints: vi.fn().mockResolvedValue({ data: { sprints: [{ id: 12, project_id: 10, name: "Sprint 12", status: "active", start_date: "2026-10-20", end_date: "2026-11-02" }], currentSprintId: 12 } }),
    getSprintBoard: vi.fn().mockResolvedValue({ data: { columns: [], tickets: [] } }),
    getBacklog: vi.fn().mockResolvedValue({ data: {
        tasks: [], summary: { total: 0, byStatus: {}, byPriority: {} }, pagination: { total: 0 },
    } }),
    getEpics: vi.fn().mockResolvedValue({ data: { epics: [] } }),
    getTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
    updateTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
    getTaskHistory: vi.fn().mockResolvedValue({ data: [] }),
    getTaskComments: vi.fn().mockResolvedValue({ data: [] }),
    getTaskWorklogs: vi.fn().mockResolvedValue({ data: { worklogs: [], time_spent_minutes: 0 } }),
    getTaskCustomFieldValues: vi.fn().mockResolvedValue({ data: {} }),
    getTaskGitRefs: vi.fn().mockResolvedValue({ data: [] }),
    getScheduleOverlays: vi.fn().mockResolvedValue({ data: null }),
    scheduleTask: vi.fn(), unscheduleTask: vi.fn(), addBacklogTask: vi.fn(),
    assignTaskToSprint: vi.fn(), updateTask: vi.fn(), bulkTaskAction: vi.fn(), rankTask: vi.fn(),
    searchTasks: vi.fn().mockResolvedValue({ data: [] }), getTaskByKey: vi.fn(),
    getRecentVelocity: vi.fn().mockResolvedValue({ data: { sprints: [], average: 0 } }),
    getSprintBurndown: vi.fn().mockResolvedValue({ data: null }),
    getSprintScope: vi.fn().mockResolvedValue({ data: null }), updateSprintGoal: vi.fn(),
    getSprintBaseline: vi.fn().mockResolvedValue({ data: {} }),
}));
vi.mock("../api/organization", () => ({
    getOrgTeams: vi.fn().mockResolvedValue({ data: [] }),
    getTeamSprintConfig: vi.fn().mockResolvedValue({ data: {} }),
    getTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
    updateTaskPreferences: vi.fn().mockResolvedValue({ data: {} }),
    getServiceDeskTickets: vi.fn().mockResolvedValue({ data: { tickets: [] } }),
    getServiceDeskStats: vi.fn().mockResolvedValue({ data: null }),
}));

import App from "../App";
import { queryClient } from "../queryClient";

beforeAll(async () => {
    await import("../pages/Tasks");
    await import("../pages/Projects");
});

describe.each(["web", "desktop"])("%s Tasks navigation through the app router", (platform) => {
    beforeEach(() => {
        auth.isAuthenticated = true;
        auth.mustChangePassword = false;
        window.history.replaceState({}, "", "/tasks/backlog");
        queryClient.clear();
        if (platform === "desktop") vi.stubGlobal("electronAPI", {});
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        queryClient.clear();
    });

    test("project settings are reachable by project admins who have an employee org role", async () => {
        window.history.replaceState({}, "", "/projects");
        render(<App />);
        expect(await screen.findByRole("heading", { name: "Projects" })).toBeVisible();
        expect(window.location.pathname).toBe("/projects");
    });

    test.each([
        ["/tasks/schedule", "backlog-tab"],
        ["/tasks/desk", "service-desk-tab"],
        ["/tasks/backlog", "backlog-tab"],
        ["/tasks/sprint/12", "sprint-tab"],
        ["/tasks/sprint/12/plan", "sprint-tab"],
        ["/tasks/schedule/?priority=high", "backlog-tab"],
        ["/tasks/archived", "backlog-tab"],
    ])("opening %s directly keeps the Tasks page", async (path, tabId) => {
        window.history.replaceState({}, "", path);
        render(<App />);
        await waitFor(() => {
            expect(window.location.pathname + window.location.search).toBe(path);
            expect(screen.getByTestId(tabId)).toBeVisible();
        });
    });

    test("an alias ticket URL opens the ticket and replaces the path with its current key", async () => {
        vi.mocked(getTaskByKey).mockResolvedValue({
            data: {
                id: 17,
                ticket_key: "ALPHA-17",
                issue_key: "ALPHA-17",
                key_alias: true,
                requested_key: "OLD-17",
            },
        } as any);
        window.history.replaceState({}, "", "/tasks/key/OLD-17");

        render(<App />);

        await waitFor(() => {
            expect(window.location.pathname).toBe("/tasks/key/ALPHA-17");
            expect(getTaskByKey).toHaveBeenCalledWith("OLD-17");
        });
    });

    test.each([
        ["Sprint", "/tasks/sprint/12", "sprint-tab"],
        ["Reports", "/tasks/reports", "reports-tab"],
    ])("clicking %s opens its tab instead of Dashboard", async (label, path, tabId) => {
        const user = userEvent.setup();
        render(<App />);
        await screen.findByTestId("backlog-tab");
        await user.click(screen.getByRole("tab", { name: label }));

        await waitFor(() => {
            expect(window.location.pathname).toBe(path);
            expect(screen.getByTestId(tabId)).toBeVisible();
            expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
        });
    });

    test("switching tabs preserves the cached Tasks page", async () => {
        const user = userEvent.setup();
        render(<App />);
        await screen.findByTestId("backlog-tab");
        const backlogButton = screen.getByRole("tab", { name: "Backlog" });
        await user.click(screen.getByRole("tab", { name: "Sprint" }));
        expect(await screen.findByTestId("sprint-tab")).toBeVisible();
        await user.click(screen.getByRole("tab", { name: "Reports" }));
        expect(await screen.findByTestId("reports-tab")).toBeVisible();
        await user.click(screen.getByRole("tab", { name: "Backlog" }));
        expect(await screen.findByTestId("backlog-tab")).toBeVisible();
        expect(screen.getByRole("tab", { name: "Backlog" })).toBe(backlogButton);
    });

    test.each([
        ["/tasks?tab=scheduled&priority=high", "/tasks/backlog?priority=high", "backlog-tab"],
        ["/tasks?tab=service-desk", "/tasks/desk", "service-desk-tab"],
    ])("legacy link %s redirects to its tab", async (entry, path, tabId) => {
        window.history.replaceState({}, "", entry);
        render(<App />);
        await waitFor(() => {
            expect(window.location.pathname + window.location.search).toBe(path);
            expect(screen.getByTestId(tabId)).toBeVisible();
        });
    });

    test.each(["/not-a-page", "/tasks-other/schedule"])("unknown route %s still redirects home", async (path) => {
        window.history.replaceState({}, "", path);
        render(<App />);
        expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeVisible();
        expect(window.location.pathname).toBe("/");
    });

    test.each(["/tasks/schedule", "/tasks/desk"])("unauthenticated access to %s still requires login", async (path) => {
        auth.isAuthenticated = false;
        window.history.replaceState({}, "", path);
        render(<App />);
        expect(await screen.findByRole("heading", { name: "Login" })).toBeVisible();
        expect(window.location.pathname).toBe("/login");
    });

    test("nested Tasks routes still enforce required password changes", async () => {
        auth.mustChangePassword = true;
        window.history.replaceState({}, "", "/tasks/schedule");
        render(<App />);
        expect(await screen.findByRole("heading", { name: "Change password" })).toBeVisible();
        expect(window.location.pathname).toBe("/change-password");
    });
});
