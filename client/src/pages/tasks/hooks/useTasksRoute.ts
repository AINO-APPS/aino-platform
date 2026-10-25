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
 * Read the view from the URL.
 *
 * An unknown or stale path degrades to the backlog rather than erroring, so a
 * bookmarked link from an older build still lands somewhere useful.
 */
export function parseTasksRoute(pathname: string, search: URLSearchParams): TasksRoute {
    const match = PATH_VIEWS.find(([pattern]) => pattern.test(pathname));
    const view = match ? match[1] : "backlog";

    const sprintFromPath = pathname.match(/^\/tasks\/sprint\/([^/]+)/)?.[1] ?? null;
    const sprintId = sprintFromPath || search.get("sprint_id") || null;
    const plan = /\/plan\/?$/.test(pathname) || search.get("view") === "plan";

    return { view, sprintId, plan };
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
