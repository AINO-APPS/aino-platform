import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getOrgTeams } from "../../../api/organization";

export type TeamScope = number | "all" | "unassigned";

const EMPTY: any[] = [];

/**
 * Team scope for the Plan area.
 *
 * An org admin (with the `team_visibility` flag on) may switch between teams,
 * browse the whole org, or open the Unassigned bucket for legacy tickets. The
 * switch narrows the sprint picker and the backlog/scheduled lists, and picks
 * a sprint from the newly selected team. Everyone else is pinned to their own
 * team, and the switcher is never rendered.
 */
export function useTeamScope(options: {
    currentUser: any;
    hasFeature: (name: string) => boolean;
    availableSprints: any[];
    setSelectedSprintId: (id: any) => void;
}) {
    const { currentUser, hasFeature, availableSprints, setSelectedSprintId } = options;
    const isOrgAdmin = ["super_admin", "hr_admin", "platform_admin"].includes(String(currentUser?.role));
    const teamVisibility = hasFeature("team_visibility");
    const showTeamSwitcher = isOrgAdmin && teamVisibility;
    const [selectedTeamId, setSelectedTeamId] = useState<TeamScope | null>(null);

    const { data: orgTeams = EMPTY } = useQuery({
        queryKey: ["tasks", "teams"],
        enabled: showTeamSwitcher,
        queryFn: async () => {
            const res = await getOrgTeams();
            return Array.isArray(res.data) ? (res.data as any[]) : EMPTY;
        },
    });

    // Admins default to their own team, falling back to the whole org when
    // they do not belong to one.
    useEffect(() => {
        if (!showTeamSwitcher || selectedTeamId !== null || orgTeams.length === 0) return;
        const ownTeam = currentUser?.team_id != null
            && orgTeams.some((team: any) => Number(team.id) === Number(currentUser.team_id))
            ? Number(currentUser.team_id)
            : "all";
        setSelectedTeamId(ownTeam as TeamScope);
    }, [showTeamSwitcher, selectedTeamId, orgTeams, currentUser?.team_id]);

    const visibleSprints = useMemo(() => {
        if (!showTeamSwitcher || selectedTeamId === null || selectedTeamId === "all") {
            return availableSprints;
        }
        if (selectedTeamId === "unassigned") return EMPTY;
        return availableSprints.filter(
            (sprint: any) => Number(sprint.team_id) === Number(selectedTeamId),
        );
    }, [availableSprints, showTeamSwitcher, selectedTeamId]);

    const teamScopeParams = useMemo(() => {
        if (!showTeamSwitcher || selectedTeamId === null) return {};
        if (selectedTeamId === "unassigned") return { unassigned: 1 };
        if (selectedTeamId === "all") return {};
        return { team_id: selectedTeamId };
    }, [showTeamSwitcher, selectedTeamId]);

    // Keep a valid sprint selected when the team changes.
    useEffect(() => {
        if (!visibleSprints.length) {
            if (showTeamSwitcher) setSelectedSprintId(null);
            return;
        }
        setSelectedSprintId((prev: any) =>
            prev && visibleSprints.some((sprint: any) => sprint.id === prev)
                ? prev
                : (visibleSprints.find((sprint: any) => sprint.status === "active")?.id
                    ?? visibleSprints[0].id),
        );
    }, [visibleSprints, showTeamSwitcher, setSelectedSprintId]);

    const changeTeam = useCallback(
        (value: TeamScope) => setSelectedTeamId(value),
        [],
    );

    return {
        isOrgAdmin,
        teamVisibility,
        showTeamSwitcher,
        orgTeams,
        selectedTeamId,
        setSelectedTeamId: changeTeam,
        visibleSprints,
        teamScopeParams,
    };
}
