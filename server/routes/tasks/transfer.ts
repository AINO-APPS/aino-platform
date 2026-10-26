// POST /api/tasks/:id/transfer — move a ticket to another team.
//
// Ownership only changes deliberately. A cross-team sprint move is rejected
// everywhere else; an org admin transfers the ticket first, and the transfer
// clears any sprint that now belongs to the old team, writes history and the
// audit log. The transfer is the only write path that changes `tasks.team_id`
// after creation.

import express from "express";
import type { Request, Response } from "express";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");
const { logAction } = require("../../utils/audit");
const redis = require("../../redis");
const { emitTaskUpdated } = require("../../utils/taskNotifications");
const { logHistory } = require("./_helpers/logHistory");
const { enrichTasks } = require("./_helpers/enrich");
const {
    isOrgAdmin,
    taskActorFromRequest,
} = require("../../modules/tasks/tasks.policy");
const { transferTicket } = require("../../modules/tasks/tasks.ownership");

const router = express.Router();

router.post("/:id/transfer", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid task ID" });

        const actor = taskActorFromRequest(req);
        if (!isOrgAdmin(actor.role)) {
            return res.status(403).json({ error: "Only an org admin can transfer a ticket" });
        }

        const requestedTeamId = parseInt(String(req.body?.team_id), 10);
        if (Number.isNaN(requestedTeamId)) {
            return res.status(400).json({ error: "team_id is required" });
        }

        const outcome = await transferTicket(req.db!, {
            taskId: id,
            toTeamId: requestedTeamId,
            orgId: actor.orgId,
        });
        if (!outcome.ok) {
            return res.status(outcome.error.status).json(outcome.error.body);
        }

        const { task: updated, oldTeamId, clearedSprint } = outcome.result;
        await logHistory(id, req.userId!, "transferred", "team", oldTeamId, requestedTeamId, null, req.db);
        if (clearedSprint) {
            await logHistory(id, req.userId!, "updated", "sprint", clearedSprint.name, "none", null, req.db);
        }
        logAction(req, "transfer", "task", id, {
            title: updated?.title,
            from_team_id: oldTeamId,
            to_team_id: requestedTeamId,
            cleared_sprint_id: clearedSprint?.id ?? null,
        });

        // The user-context cache is short-lived but transfer must not leave
        // anyone with a stale view of their team's work.
        for (const affected of new Set([updated?.user_id, updated?.assigned_to, req.userId])) {
            if (affected) {
                try { await redis.invalidateUserContext(req.tenantId, affected); } catch { /* best effort */ }
            }
        }

        const enriched = await enrichTasks([updated], req.db);
        emitTaskUpdated(req.tenantId, id, "updated", [updated?.assigned_to, updated?.user_id, req.userId!], {
            fields: { team_id: requestedTeamId, sprint_id: clearedSprint ? null : updated?.sprint_id },
            actor: { id: req.userId!, name: null },
        });

        res.json({
            task: enriched[0],
            transferred: true,
            from_team_id: oldTeamId,
            to_team_id: requestedTeamId,
            cleared_sprint: clearedSprint,
        });
    } catch (err) {
        req.log.error({ err }, "Error transferring task:");
        res.status(500).json({ error: "Failed to transfer task" });
    }
});

export = router;
