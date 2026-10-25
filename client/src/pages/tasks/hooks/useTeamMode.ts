import { useEffect, useState } from "react";
import { getTeamSprintConfig } from "../../../api/organization";

export type TeamMode = "sprints" | "continuous";

/**
 * The team's resolved sprint mode.
 *
 * Web edits it (agile configuration is web-only); every client reads the
 * resolved value and presents it. The backlog keeps its meaning in both modes.
 */
export function useTeamMode(teamId: number | string | null | undefined) {
    const [mode, setMode] = useState<TeamMode>("sprints");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!teamId) {
            setMode("sprints");
            return;
        }
        let cancelled = false;
        setLoading(true);
        getTeamSprintConfig(teamId)
            .then((res) => {
                if (cancelled) return;
                const resolved = res.data?.teamMode
                    ?? (res.data?.sprintMode === "auto" ? "continuous" : "sprints");
                setMode(resolved);
            })
            .catch(() => {
                // A failed read falls back to sprints mode rather than blocking.
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [teamId]);

    return { mode, loading, isContinuous: mode === "continuous" };
}
