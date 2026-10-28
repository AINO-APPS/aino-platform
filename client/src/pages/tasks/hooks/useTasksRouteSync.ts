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
import { LEGACY_TABS, landingTasksPath, sprintIdFrom, tasksViewPath, type TasksRoute } from "./useTasksRoute";

interface RouteSyncOptions {
    route: TasksRoute;
    searchParams: URLSearchParams;
    navigate: NavigateFunction;
    setActiveTab: (tab: string) => void;
    setSelectedSprintId: (id: any) => void;
    /** The selected team's sprints; an active one is what offers the Sprint tab. */
    availableSprints?: any[];
    /** False until the sprint list (and an admin's team choice) has resolved. */
    sprintsLoaded?: boolean;
}

export function useTasksRouteSync({
    route,
    searchParams,
    navigate,
    setActiveTab,
    setSelectedSprintId,
    availableSprints = [],
    sprintsLoaded = true,
}: RouteSyncOptions) {
    const { hasFeature } = useFeatures() as any;
    useEffect(() => {
        const tabParam = searchParams.get("tab");
        if (tabParam && LEGACY_TABS.some((tab) => tab === tabParam)) {
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
            const { tabs, activeSprintId } = planningTabs({
                agileEnabled: hasFeature("agile"),
                sprints: availableSprints,
            });
            if (route.view === "sprint" && !route.sprintId) {
                navigate(
                    activeSprintId && tabs.includes("sprint")
                        ? tasksViewPath("sprint", activeSprintId)
                        : tasksViewPath("backlog", null),
                    { replace: true },
                );
                return;
            }
            if (!tabs.includes(route.view)) {
                navigate(tasksViewPath("backlog", null), { replace: true });
                return;
            }
        }
        setActiveTab(route.view);
        if (route.sprintId) setSelectedSprintId(sprintIdFrom(route.sprintId));
    }, [route.view, route.sprintId, searchParams, navigate, setActiveTab, setSelectedSprintId, availableSprints, sprintsLoaded, hasFeature]);
}

/**
 * Send the bare `/tasks` entry point to the running sprint's board.
 *
 * Once a team's sprint is started, the board is where the work is; the backlog
 * is only the pool of unplanned tickets. Explicit views — a bookmark to
 * `/tasks/backlog`, a shared `/tasks/sprint/9`, a tab the user chose — are
 * always honoured, so this only ever fires once, on the bare entry point, and
 * only after the selected team's sprints have loaded.
 */
export function useSprintLanding({
    pathname,
    availableSprints,
    sprintsLoaded = true,
    agileEnabled,
    navigate,
}: {
    pathname: string;
    availableSprints: any[];
    sprintsLoaded?: boolean;
    agileEnabled: boolean;
    navigate: NavigateFunction;
}) {
    const applied = useRef(false);

    useEffect(() => {
        if (applied.current || !sprintsLoaded) return;
        const { activeSprintId } = planningTabs({ agileEnabled, sprints: availableSprints });
        const target = landingTasksPath(pathname, activeSprintId);
        applied.current = true;
        if (target !== pathname) navigate(target, { replace: true });
    }, [pathname, availableSprints, sprintsLoaded, agileEnabled, navigate]);
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
