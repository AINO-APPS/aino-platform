// POST /api/tasks/:id/transfer — move a ticket to another team.
//
// Compatibility adapter: the target team's generated project is the destination.
// Flag-off transfers retain admin-only team ownership changes; after switch-over
// members move projects and legacy team ownership stays available for rollback.

import express from "express";
import type { Request, Response } from "express";
import { sendHierarchyRefusal } from "./_helpers/hierarchy";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");
const redis = require("../../redis");
const { placementContext, PlacementRefused, sendPlacementRefusal } = require("./_helpers/placement");
const { enrichTasks } = require("./_helpers/enrich");
const {
    taskActorFromRequest,
} = require("../../modules/tasks/tasks.policy");
const { transferTicket } = require("../../modules/tasks/tasks.placement");
const { findTask } = require("../../modules/tasks/tasks.repository");
const { ticketActionConflict } = require("./_helpers/access");

const router = express.Router();

router.post("/:id/transfer", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid task ID" });

        const actor = taskActorFromRequest(req);
        const task = await findTask(req.db!, id);
        if (!task) return res.status(404).json({ error: "Task not found" });
        const refusal = await ticketActionConflict(req.db!, actor, task, "transfer");
        if (refusal) return res.status(refusal.status).json(refusal.body);
        const requestedTeamId = parseInt(String(req.body?.team_id), 10);
        if (Number.isNaN(requestedTeamId)) {
            return res.status(400).json({ error: "team_id is required" });
        }

        const outcome = await req.db!.transaction!(async (client: any, { afterCommit }: any) => {
            const result = await transferTicket(
                placementContext(req, client, afterCommit, { orgId: actor.orgId }),
                id,
                requestedTeamId,
            );
            if (!result.ok) throw new PlacementRefused(result);
            return result;
        });

        const { task: updated, oldTeamId, clearedSprint } = outcome;

        // The user-context cache is short-lived but transfer must not leave
        // anyone with a stale view of their team's work.
        for (const affected of new Set([updated?.user_id, updated?.assigned_to, req.userId])) {
            if (affected) {
                try { await redis.invalidateUserContext(req.tenantId, affected); } catch { /* best effort */ }
            }
        }

        const enriched = await enrichTasks([updated], req.db, actor);

        res.json({
            task: enriched[0],
            transferred: true,
            from_team_id: oldTeamId,
            to_team_id: requestedTeamId,
            cleared_sprint: clearedSprint,
        });
    } catch (err) {
        if (sendHierarchyRefusal(res, err)) return;
        if (sendPlacementRefusal(res, err)) return;
        req.log.error({ err }, "Error transferring task:");
        res.status(500).json({ error: "Failed to transfer task" });
    }
});

export = router;
