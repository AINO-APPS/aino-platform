import s from "../Tasks.module.css";
import { isOrgAdminRole } from "./taskStatus";

/**
 * Persistent explanation for a user with no team. They still see the tickets
 * they created or are assigned to; the Sprint tab disappears because there is
 * no team sprint to show.
 */
export default function TeamFallbackBanner({ user, teamVisibility }: { user: any; teamVisibility: boolean }) {
    const show = teamVisibility && !isOrgAdminRole(user?.role) && !user?.team_id;
    if (!show) return null;
    return (
        <div className={s["team-fallback-banner"]} role="status">
            You're not assigned to a team yet. You'll only see tickets you
            created or are assigned to. Ask an admin to add you to a team to
            see your team's backlog and sprints.
        </div>
    );
}
