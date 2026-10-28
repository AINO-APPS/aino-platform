import { useEffect, useRef } from "react";

/**
 * Land on the selected team's surface when an admin switches teams.
 *
 * The tabs follow the selected team's sprint state, so after a switch the
 * current URL can name a surface that team does not have. A team with a
 * running sprint opens on its board; otherwise a Sprint view falls back to the
 * backlog. Non-surface views (Service Desk) are left alone.
 */
export function useTeamSwitchNavigation({
    selectedTeamId,
    visibleSprints,
    activeTab,
    goToView,
}: {
    selectedTeamId: unknown;
    visibleSprints: any[];
    activeTab: string;
    goToView: (view: any, sprintId?: any) => void;
}) {
    const previous = useRef<unknown>(null);

    useEffect(() => {
        const before = previous.current;
        previous.current = selectedTeamId;
        if (before === null || before === selectedTeamId) return;
        if (!["sprint", "backlog", "scheduled"].includes(activeTab)) return;
        const active = visibleSprints.find((sprint) => sprint.status === "active");
        if (active) goToView("sprint", active.id);
        else if (activeTab === "sprint") goToView("backlog");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTeamId]);
}
