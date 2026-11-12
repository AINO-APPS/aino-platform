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
import { useFeatures } from "../../../FeaturesContext";
import { planningTabs } from "./usePlanningSurface";
import { LEGACY_TABS, landingTasksPath, sprintIdFrom, tasksViewPath, type TasksRoute, type TasksView } from "./useTasksRoute";

function legacyTab(value: string | null): TasksView | undefined {
    if (value === "schedule" || value === "scheduled") return "backlog";
    return LEGACY_TABS.find(tab => tab === value);
}

interface RouteSyncOptions {
    planTabs?: TasksView[];
    route: TasksRoute;
    searchParams: URLSearchParams;
    navigate: NavigateFunction;
    setActiveTab: (tab: string) => void;
    setSelectedSprintId: (id: any) => void;
    currentSprintId?: number | string | null;
    /** False until the sprint list (and an admin's team choice) has resolved. */
    sprintsLoaded?: boolean;
}

export function useTasksRouteSync({
    planTabs,
    route,
    searchParams,
    navigate,
    setActiveTab,
    setSelectedSprintId,
    currentSprintId = null,
    sprintsLoaded = true,
}: RouteSyncOptions) {
    const { hasFeature } = useFeatures() as any;
    useEffect(() => {
        const tabParam = legacyTab(searchParams.get("tab"));
        if (tabParam) {
            const next = new URLSearchParams(searchParams);
            next.delete("tab");
            const query = next.toString();
            navigate(
                `${tasksViewPath(tabParam as any, searchParams.get("sprint_id"))}${query ? `?${query}` : ""}`,
                { replace: true },
            );
            return;
        }
        // A URL can point at a surface this team does not have — an old
        // bookmark, a shared link, or a tab picked before the sprint list
        // resolved. Sprint and Scheduled are alternatives, so leave for the
        // backlog rather than render a view with no button back to it. The
        // route is what `activeTab` derives from, so this must navigate.
        // A named sprint (`/tasks/sprint/9`, its plan) stays reachable for
        // planning a future sprint.
        if (sprintsLoaded) {
            const { tabs, currentSprintId: current } = planningTabs({
                agileEnabled: hasFeature("agile"),
                currentSprintId, planTabs,
            });
            if (route.view === "sprint" && !route.sprintId && (!planTabs || current != null)) {
                navigate(
                    current && tabs.includes("sprint")
                        ? tasksViewPath("sprint", current)
                        : tasksViewPath("backlog", null),
                    { replace: true },
                );
                return;
            }
            // A named sprint is reachable even with nothing running: that is how
            // a future sprint is planned. Everything else must be a tab the
            // team has.
            const namedSprint = route.view === "sprint" && route.sprintId != null && (!planTabs || tabs.includes("sprint"));
            if (!namedSprint && !tabs.includes(route.view)) {
                navigate(tasksViewPath(planTabs?.[0] ?? "backlog", null), { replace: true });
                return;
            }
        }
        setActiveTab(route.view);
        if (route.sprintId) setSelectedSprintId(sprintIdFrom(route.sprintId));
    }, [route.view, route.sprintId, searchParams, navigate, setActiveTab, setSelectedSprintId, currentSprintId, sprintsLoaded, hasFeature, planTabs]);
}

/**
 * Send the bare `/tasks` entry point to the server-selected current sprint.
 *
 * When a team has a current sprint, the board is where the work is; the backlog
 * is only the pool of unplanned tickets. Explicit views — a bookmark to
 * `/tasks/backlog`, a shared `/tasks/sprint/9`, a tab the user chose — are
 * always honoured, so this only ever fires once, on the bare entry point, and
 * only after the selected team's sprints have loaded.
 */
export function useSprintLanding({
    planTabs,
    pathname,
    search = "",
    currentSprintId,
    sprintsLoaded = true,
    agileEnabled,
    navigate,
}: {
    planTabs?: TasksView[];
    pathname: string;
    search?: string;
    currentSprintId: number | string | null;
    sprintsLoaded?: boolean;
    agileEnabled: boolean;
    navigate: NavigateFunction;
}) {
    const applied = useRef(false);

    useEffect(() => {
        if (applied.current || !sprintsLoaded || legacyTab(new URLSearchParams(search).get("tab"))) return;
        const { currentSprintId: current } = planningTabs({ agileEnabled, currentSprintId, planTabs });
        const target = planTabs && (pathname === "/tasks" || pathname === "/tasks/")
            ? tasksViewPath(planTabs[0]) : landingTasksPath(pathname, current);
        applied.current = true;
        if (target !== pathname) navigate(`${target}${search}`, { replace: true });
    }, [pathname, search, currentSprintId, sprintsLoaded, agileEnabled, navigate, planTabs]);
}

/** Open the task named by `?task=` once, on arrival. */
export function useTaskDeepLink(
    searchParams: URLSearchParams,
    openTaskDetail: (task: any) => void,
    pathname: string,
    navigate: NavigateFunction,
) {
    const lastRequest = useRef<string | null>(null);
    const pathKeyMatch = pathname.match(/^\/tasks\/key\/([^/]+)\/?$/);
    let pathKey: string | null = null;
    try {
        pathKey = pathKeyMatch ? decodeURIComponent(pathKeyMatch[1]) : null;
    } catch {
        pathKey = null;
    }
    const taskParam = searchParams.get("task");
    const requestedKey = pathKey || (taskParam && !/^\d+$/.test(taskParam) ? taskParam : null);
    const requestId = requestedKey ? `key:${requestedKey}` : taskParam ? `id:${taskParam}` : null;

    useEffect(() => {
        if (!requestId) {
            lastRequest.current = null;
            return;
        }
        if (lastRequest.current === requestId) return;
        lastRequest.current = requestId;

        const request = requestedKey ? getTaskByKey(requestedKey) : getTaskDetail(taskParam!);
        request
            .then((res) => {
                const task = res.data as any;
                const currentKey = task.ticket_key || task.issue_key;
                if (task.key_alias && currentKey) {
                    if (pathKey) {
                        lastRequest.current = `key:${currentKey}`;
                        navigate(`/tasks/key/${encodeURIComponent(currentKey)}`, { replace: true });
                    } else if (taskParam) {
                        const next = new URLSearchParams(searchParams);
                        next.set("task", currentKey);
                        lastRequest.current = `key:${currentKey}`;
                        const query = next.toString();
                        navigate(`${pathname}${query ? `?${query}` : ""}`, { replace: true });
                    }
                }
                openTaskDetail(task);
            })
            .catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname, searchParams, requestId]);
}
