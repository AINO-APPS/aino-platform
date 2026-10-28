/**
 * Which planning surface a team gets: Sprint, or dated work.
 *
 * They are alternatives, not companions. A team that plans in sprints puts work
 * in a sprint, so a second dated list beside it is noise. A team with no sprint
 * config has nowhere to put work but a date, so that dated list is the only way
 * its due dates mean anything. Backlog and Service Desk belong to both.
 *
 * The gate is the team's own sprint config, which the profile reports as
 * `team_sprint_enabled`. It is deliberately not inferred from the sprint list:
 * `GET /tasks/available-sprints` materialises sprint rows as a side effect of
 * being read and only returns active/planned ones, so the list answers a
 * different question and would make the tab row flicker.
 */

/** Does this team work in sprints? */
export function isSprintEnabled(
    currentUser: any,
    agileEnabled: boolean,
    availableSprints: any[],
): boolean {
    if (!agileEnabled) return false;
    // `undefined` is an older server: fall back to the sprint list so an
    // un-upgraded deploy keeps its Sprint tab instead of losing it.
    return currentUser?.team_sprint_enabled ?? availableSprints.length > 0;
}
