/**
 * Keep the Tasks page in step with its route.
 *
 * The URL is the source of truth for the view. Legacy `?tab=` links are
 * redirected to their route so old bookmarks keep working, and a deep link to
 * a specific task opens its detail on arrival.
 */
import { useEffect, useRef } from "react";
import type { NavigateFunction } from "react-router-dom";
import { getTaskByKey, getTaskDetail } from "../../../api/tasks";
import { landingTasksPath, tasksViewPath, type TasksRoute } from "./useTasksRoute";

const LEGACY_TABS = ["backlog", "sprint", "scheduled", "service-desk"];

interface RouteSyncOptions {
    route: TasksRoute;
    searchParams: URLSearchParams;
    navigate: NavigateFunction;
    setActiveTab: (tab: string) => void;
    setSelectedSprintId: (id: any) => void;
}

export function useTasksRouteSync({
    route,
    searchParams,
    navigate,
    setActiveTab,
    setSelectedSprintId,
}: RouteSyncOptions) {
    useEffect(() => {
        const tabParam = searchParams.get("tab");
        if (tabParam && LEGACY_TABS.includes(tabParam)) {
            const next = new URLSearchParams(searchParams);
            next.delete("tab");
            const query = next.toString();
            navigate(
                `${tasksViewPath(tabParam as any, searchParams.get("sprint_id"))}${query ? `?${query}` : ""}`,
                { replace: true },
            );
            return;
        }
        setActiveTab(route.view);
        if (route.sprintId) {
            const parsed = Number(route.sprintId);
            setSelectedSprintId(Number.isNaN(parsed) ? route.sprintId : parsed);
        }
    }, [route.view, route.sprintId, searchParams, navigate, setActiveTab, setSelectedSprintId]);
}

/**
 * Send the bare `/tasks` entry point to the running sprint's plan.
 *
 * Once a team's sprint is started, the sprint plan is where the work is; the
 * backlog is only the pool of unplanned tickets. Explicit views — a bookmark to
 * `/tasks/backlog`, a shared `/tasks/sprint/9`, a tab the user chose — are
 * always honoured, so this only ever fires once, on the bare entry point.
 */
export function useSprintLanding({
    pathname,
    availableSprints,
    agileEnabled,
    navigate,
}: {
    pathname: string;
    availableSprints: any[];
    agileEnabled: boolean;
    navigate: NavigateFunction;
}) {
    const applied = useRef(false);

    useEffect(() => {
        if (applied.current) return;
        if (!agileEnabled || !availableSprints.length) return;
        const active = availableSprints.find((sprint) => sprint.status === "active");
        const target = landingTasksPath(pathname, active?.id ?? null);
        applied.current = true;
        if (target !== pathname) navigate(target, { replace: true });
    }, [pathname, availableSprints, agileEnabled, navigate]);
}

/** Open the task named by `?task=` once, on arrival. */
export function useTaskDeepLink(
    searchParams: URLSearchParams,
    openTaskDetail: (task: any) => void,
) {
    useEffect(() => {
        const taskId = searchParams.get("task");
        if (!taskId) return;
        // A canonical key (PROJ-123) resolves through its own endpoint; a
        // numeric id uses the detail endpoint.
        const request = /^[A-Za-z][A-Za-z0-9_]{1,9}-\d+$/.test(taskId)
            ? getTaskByKey(taskId)
            : getTaskDetail(taskId);
        request
            .then((res) => openTaskDetail(res.data))
            .catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);
}
