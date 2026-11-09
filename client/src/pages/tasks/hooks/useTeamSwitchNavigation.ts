import { useEffect, useRef } from "react";

/**
 * Land on the selected team's surface when an admin switches teams.
 *
 * The tabs follow the selected team's sprint state, so after a switch the
 * current URL can name a surface that team does not have. A team with a
 * current sprint opens on its board; otherwise a Sprint view falls back to the
 * backlog. Non-surface views (Service Desk) are left alone.
 */
export function useTeamSwitchNavigation({
    planTabs,
    selectedTeamId,
    currentSprintId,
    currentSprintLoaded = true,
    activeTab,
    goToView,
}: {
    planTabs?: string[];
    selectedTeamId: unknown;
    currentSprintId: number | string | null;
    currentSprintLoaded?: boolean;
    activeTab: string;
    goToView: (view: any, sprintId?: any) => void;
}) {
    const previous = useRef<unknown>(null);

    useEffect(() => {
        const before = previous.current;
        if (before === null) {
            previous.current = selectedTeamId;
            return;
        }
        if (before === selectedTeamId || !currentSprintLoaded) return;
        previous.current = selectedTeamId;
        if (planTabs) {
            if (activeTab !== "service-desk") goToView(planTabs[0]);
            return;
        }
        if (!["sprint", "backlog"].includes(activeTab)) return;
        if (currentSprintId != null) goToView("sprint", currentSprintId);
        else if (activeTab === "sprint") goToView("backlog");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTeamId, currentSprintId, currentSprintLoaded]);
}
