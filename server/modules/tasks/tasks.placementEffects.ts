/**
 * The production adapter for placement effects: what the rest of the system
 * hears after a placement commits.
 *
 *   * `task_updated` with a field delta to the ticket's people and its owning
 *     team — both teams on a transfer — so cards move on every board.
 *   * The "added to sprint" notification to the assignee and reporter (never
 *     the actor), only when a ticket joins a sprint. Leaving a sprint or
 *     changing a day is not worth interrupting anyone for.
 *
 * Best-effort: runs after COMMIT, so a failure here never loses a move.
 */
import type { PlacementChange, PlacementEffects } from "./tasks.placement";
import { findPlacementProjectAudience } from "./tasks.repository";
import { describeSprintTaskAdded, taskNotificationLink } from "./tasks.notifications";
import type { TasksDb } from "./tasks.types";
import { emitTaskUpdated } from "../../utils/taskNotifications";
import { notifyUser } from "../../realtime/fanout";

type EffectsDb = TasksDb;

/**
 * `db` must be a non-transactional handle (the request's tenant DB): effects
 * run after the placement transaction has committed and released its client.
 * `notify: false` keeps the broadcast but skips the sprint-added notification,
 * for a ticket created straight into a sprint (the creator already knows).
 */
export function realtimeEffects(options: {
    db: EffectsDb;
    tenantId: number | null | undefined;
    notify?: boolean;
}): PlacementEffects {
    const { db, tenantId, notify = true } = options;
    return {
        async changed({ before, after, actor }: PlacementChange): Promise<void> {
            const projects = [...new Set([before.project_id, after.project_id].filter((id) => id != null).map(Number))];
            const members = await findPlacementProjectAudience(db, projects, after.org_id);
            const recipients = [after.assigned_to, after.user_id, actor.userId, ...members];
            emitTaskUpdated(tenantId, Number(after.id), "updated", recipients);

            if (!notify || after.sprint_id == null || String(after.sprint_id) === String(before.sprint_id ?? null)) return;
            const sprint = (await db.query(
                `SELECT s.name
                   FROM sprints s
                   JOIN projects p ON p.id = s.project_id
                   JOIN tasks t ON t.sprint_id = s.id AND t.project_id = s.project_id
                  WHERE s.id = $1
                    AND t.id = $2
                    AND t.org_id IS NOT DISTINCT FROM $3
                    AND p.org_id IS NOT DISTINCT FROM $3`,
                [after.sprint_id, after.id, after.org_id],
            )).rows[0];
            if (!sprint) return;
            const { title, body, audience } = describeSprintTaskAdded({ task: after, sprint, actorId: actor.userId });
            for (const userId of audience) {
                await notifyUser(db, tenantId, userId, "sprint", title, body, {
                    link: taskNotificationLink(after.id),
                    linkTaskId: after.id,
                    actorId: actor.userId,
                }).catch(() => undefined);
            }
        },
    };
}
