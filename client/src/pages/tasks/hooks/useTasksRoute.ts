import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

export type TasksView = "backlog" | "sprint" | "scheduled" | "service-desk";

export interface TasksRoute {
    view: TasksView;
    sprintId: string | null;
    /** True when the URL names the sprint Plan view rather than the Board. */
    plan: boolean;
}

const VIEW_PATHS: Record<TasksView, string> = {
    backlog: "/tasks/backlog",
    sprint: "/tasks/sprint",
    scheduled: "/tasks/schedule",
    "service-desk": "/tasks/desk",
};

/** Legacy `?tab=` values, redirected to their route by the page. */
export const LEGACY_TABS: TasksView[] = ["backlog", "sprint", "scheduled", "service-desk"];

const PATH_VIEWS: Array<[RegExp, TasksView]> = [
    [/^\/tasks\/backlog\/?$/, "backlog"],
    [/^\/tasks\/sprint(\/|$)/, "sprint"],
    [/^\/tasks\/schedule\/?$/, "scheduled"],
    [/^\/tasks\/desk\/?$/, "service-desk"],
];

/** The canonical path for a view, including the sprint when there is one. */
export function tasksViewPath(view: TasksView, sprintId?: string | number | null, plan = false): string {
    if (view === "sprint" && sprintId) {
        return `/tasks/sprint/${sprintId}${plan ? "/plan" : ""}`;
    }
    return VIEW_PATHS[view];
}

/**
 * Where the Tasks page should land for a given entry path.
 *
 * Once a team's sprint is running, the sprint plan is where the work is — the
 * backlog is only the pool of unplanned tickets. So the bare `/tasks` entry
 * point opens the active sprint's plan. Every explicit view is honoured: a
 * bookmark to `/tasks/backlog`, a shared `/tasks/sprint/9`, a chosen tab.
 */
export function landingTasksPath(pathname: string, activeSprintId: number | string | null): string {
    const isBareEntry = pathname === "/tasks" || pathname === "/tasks/";
    if (!isBareEntry) return pathname;
    return activeSprintId
        ? tasksViewPath("sprint", activeSprintId, true)
        : VIEW_PATHS.backlog;
}

/**
 * Read the view from the URL.
 *
 * An unknown or stale path degrades to the backlog rather than erroring, so a
 * bookmarked link from an older build still lands somewhere useful.
 */
export function parseTasksRoute(pathname: string, search: URLSearchParams): TasksRoute {
    const match = PATH_VIEWS.find(([pattern]) => pattern.test(pathname));
    // A legacy `?tab=` link names its view too, so redirecting it does not
    // flash (or fetch) the backlog first.
    const legacyTab = LEGACY_TABS.find((tab) => tab === search.get("tab"));
    const view = match ? match[1] : (legacyTab ?? "backlog");

    const sprintFromPath = pathname.match(/^\/tasks\/sprint\/([^/]+)/)?.[1] ?? null;
    const sprintId = sprintFromPath || search.get("sprint_id") || null;
    const plan = /\/plan\/?$/.test(pathname) || search.get("view") === "plan";

    return { view, sprintId, plan };
}

/** Numeric sprint ids stay numbers; anything else is kept verbatim. */
export function sprintIdFrom(value: string | null): number | string | null {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value : parsed;
}

/**
 * Filters that live in the query string, so a view can be bookmarked and
 * shared. Only recognised keys are read; anything else is ignored.
 */
export interface TasksUrlFilters {
    assignee: string;
    label: string;
    priority: string;
    status: string;
    search: string;
    project: string;
    epic: string;
    type: string;
    completed: string;
}

const FILTER_KEYS: Array<keyof TasksUrlFilters> = [
    "assignee",
    "label",
    "priority",
    "status",
    "search",
    "project",
    "epic",
    "type",
    "completed",
];

export function readUrlFilters(search: URLSearchParams): TasksUrlFilters {
    const filters = {} as TasksUrlFilters;
    for (const key of FILTER_KEYS) {
        filters[key] = search.get(key) ?? "";
    }
    return filters;
}

/** Write filters back, dropping empty values so URLs stay short. */
export function writeUrlFilters(
    search: URLSearchParams,
    filters: Partial<TasksUrlFilters>,
): URLSearchParams {
    const next = new URLSearchParams(search);
    for (const key of FILTER_KEYS) {
        if (!(key in filters)) continue;
        const value = filters[key];
        if (value) next.set(key, value);
        else next.delete(key);
    }
    return next;
}

/**
 * Route-backed Tasks navigation.
 *
 * Tabs are real routes and filters live in the query string, so opening a
 * shared URL reproduces the identical view.
 */
export function useTasksRoute() {
    const location = useLocation();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const route = useMemo(
        () => parseTasksRoute(location.pathname, searchParams),
        [location.pathname, searchParams],
    );
    const filters = useMemo(() => readUrlFilters(searchParams), [searchParams]);

    const goToView = useCallback(
        (view: TasksView, sprintId?: string | number | null, plan = false) => {
            navigate(tasksViewPath(view, sprintId, plan));
        },
        [navigate],
    );

    const setFilters = useCallback(
        (patch: Partial<TasksUrlFilters>) => {
            setSearchParams(writeUrlFilters(searchParams, patch), { replace: true });
        },
        [searchParams, setSearchParams],
    );

    return { route, filters, goToView, setFilters };
}
