/**
 * Team sprint mode.
 *
 * A team is in one of two modes:
 *   - `sprints`    — explicit planned → active → completed lifecycle.
 *   - `continuous` — one auto-managed sprint rolls forward on a cadence.
 *
 * The stored column is `teams.sprint_mode` (`manual` | `auto`). This module is
 * the single translation between the stored value and the mode every client
 * reads, so web, desktop, Android and iOS cannot disagree.
 *
 * The backlog keeps its meaning in both modes: `sprint_id IS NULL` is always
 * the backlog.
 */

export type TeamMode = "sprints" | "continuous";

export interface TeamModeRow {
    sprint_mode?: string | null;
    auto_managed?: boolean | null;
}

/** The mode a client should present. */
export function resolveTeamMode(team: TeamModeRow | null | undefined): TeamMode {
    if (!team) return "sprints";
    return team.sprint_mode === "auto" ? "continuous" : "sprints";
}

/** The stored value for a mode, for the web-only editor. */
export function storedSprintMode(mode: TeamMode): "manual" | "auto" {
    return mode === "continuous" ? "auto" : "manual";
}

/** Whether the mode may be changed from this client. */
export function canEditTeamMode(isWeb: boolean): boolean {
    // Agile configuration is web-only; native clients read the resolved mode.
    return isWeb;
}

/** Whether a sprint in this mode is the rolling one. */
export function isRollingSprint(team: TeamModeRow | null | undefined, sprint: { auto_managed?: boolean | null } | null | undefined): boolean {
    return resolveTeamMode(team) === "continuous" && Boolean(sprint?.auto_managed);
}
