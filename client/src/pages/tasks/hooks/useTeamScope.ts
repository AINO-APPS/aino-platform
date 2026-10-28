import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getOrgTeams } from "../../../api/organization";

export type TeamScope = number | "unassigned";

/** Roles that may browse any team's Tasks (super admin and above). */
export const TEAM_PICKER_ROLES = ["super_admin", "platform_admin"];
export const TEAM_SCOPE_STORAGE_KEY = "tasks.selectedTeamId";

const EMPTY: any[] = [];

function readStoredTeam(): TeamScope | null {
    try {
        const raw = localStorage.getItem(TEAM_SCOPE_STORAGE_KEY);
        if (!raw) return null;
        if (raw === "unassigned") return raw;
        const id = Number(raw);
        return Number.isFinite(id) ? id : null;
    } catch {
        return null;
    }
}

/**
 * Team scope for the Tasks area.
 *
 * Super admin and above pick one team at a time (or the Unassigned bucket for
 * legacy tickets); there is no merged view, because one board cannot show
 * several sprints. The chosen team narrows the sprint list — which drives the
 * tabs and the landing view — and the backlog/scheduled queries. The choice is
 * remembered. Everyone else is pinned to their own team.
 */
export function useTeamScope(options: {
    currentUser: any;
    availableSprints: any[];
    setSelectedSprintId: (id: any) => void;
}) {
    const { currentUser, availableSprints, setSelectedSprintId } = options;
    const showTeamSwitcher = TEAM_PICKER_ROLES.includes(String(currentUser?.role));
    const [selectedTeamId, setSelectedTeamId] = useState<TeamScope | null>(null);

    const { data: orgTeams = EMPTY } = useQuery({
        queryKey: ["tasks", "teams"],
        enabled: showTeamSwitcher,
        queryFn: async () => {
            const res = await getOrgTeams();
            return Array.isArray(res.data) ? (res.data as any[]) : EMPTY;
        },
    });

    // Default: the remembered team, else the admin's own, else the first team.
    useEffect(() => {
        if (!showTeamSwitcher || selectedTeamId !== null || orgTeams.length === 0) return;
        const known = (id: unknown) => orgTeams.some((team: any) => Number(team.id) === Number(id));
        const stored = readStoredTeam();
        const next: TeamScope =
            stored === "unassigned" || (stored != null && known(stored))
                ? stored
                : currentUser?.team_id != null && known(currentUser.team_id)
                    ? Number(currentUser.team_id)
                    : Number(orgTeams[0].id);
        setSelectedTeamId(next);
    }, [showTeamSwitcher, selectedTeamId, orgTeams, currentUser?.team_id]);

    /** The team whose sprint state drives the page; null for Unassigned. */
    const effectiveTeamId: number | null = showTeamSwitcher
        ? (typeof selectedTeamId === "number" ? selectedTeamId : null)
        : (currentUser?.team_id != null ? Number(currentUser.team_id) : null);

    const visibleSprints = useMemo(() => {
        if (showTeamSwitcher && selectedTeamId === null) return EMPTY;
        if (effectiveTeamId == null) return showTeamSwitcher ? EMPTY : availableSprints;
        return availableSprints.filter(
            (sprint: any) => sprint.team_id == null || Number(sprint.team_id) === effectiveTeamId,
        );
    }, [availableSprints, showTeamSwitcher, selectedTeamId, effectiveTeamId]);

    const teamScopeParams = useMemo(() => {
        // The server treats HR admins as org-wide; without the picker they
        // are pinned to their own team explicitly.
        if (!showTeamSwitcher) {
            return currentUser?.role === "hr_admin" && effectiveTeamId != null
                ? { team_id: effectiveTeamId }
                : {};
        }
        if (selectedTeamId === null) return {};
        if (selectedTeamId === "unassigned") return { unassigned: 1 };
        return { team_id: selectedTeamId };
    }, [showTeamSwitcher, selectedTeamId, currentUser?.role, effectiveTeamId]);

    // Keep a valid sprint selected — the active one — when the team changes.
    useEffect(() => {
        if (!visibleSprints.length) {
            setSelectedSprintId(null);
            return;
        }
        setSelectedSprintId((prev: any) =>
            prev && visibleSprints.some((sprint: any) => sprint.id === prev)
                ? prev
                : (visibleSprints.find((sprint: any) => sprint.status === "active")?.id
                    ?? visibleSprints[0].id),
        );
    }, [visibleSprints, setSelectedSprintId]);

    const changeTeam = useCallback((value: TeamScope) => {
        setSelectedTeamId(value);
        try {
            localStorage.setItem(TEAM_SCOPE_STORAGE_KEY, String(value));
        } catch {
            /* storage unavailable */
        }
    }, []);

    return {
        isOrgAdmin: showTeamSwitcher,
        showTeamSwitcher,
        orgTeams,
        selectedTeamId,
        setSelectedTeamId: changeTeam,
        effectiveTeamId,
        visibleSprints,
        teamScopeParams,
    };
}
