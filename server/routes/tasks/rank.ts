// Ranked backlog reorder.
//   PATCH /api/tasks/:id/rank  — body { beforeId, afterId }
//
// The server computes the LexoRank value from the intended neighbours, so two
// people dragging at once cannot corrupt the sequence and a client can never
// invent a position.

import express from "express";
import type { Request, Response } from "express";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");
const { logHistory } = require("./_helpers/logHistory");

const { canAccessTask, denyTaskAccess } = require("./_helpers/access");
const { taskActorFromRequest } = require('../../modules/tasks/tasks.policy');
const { rankForMove } = require("../../modules/tasks/tasks.rank");
const { findRank, setRank, findTask } = require("../../modules/tasks/tasks.repository");

const router = express.Router();

async function rankOf(req: Request, id: unknown): Promise<string | null> {
    if (id === null || id === undefined || id === "") return null;
    const parsed = Number.parseInt(String(id), 10);
    if (Number.isNaN(parsed)) return null;
    return findRank(req.db!, parsed, req.userOrgId);
}

router.patch("/:id/rank", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { beforeId, afterId } = req.body as { beforeId?: unknown; afterId?: unknown };

        const task = await findTask(req.db!, id);
        if (!await canAccessTask(task, taskActorFromRequest(req), req.db)) {
            return denyTaskAccess(res, task, taskActorFromRequest(req));
        }

        const before = await rankOf(req, beforeId);
        const after = await rankOf(req, afterId);

        let rank: string;
        try {
            rank = rankForMove(before, after);
        } catch (err) {
            return res.status(409).json({
                error: (err as Error).message,
                code: "RANK_OUT_OF_ORDER",
            });
        }

        await setRank(req.db!, id, rank);
        await logHistory(id, req.userId, "ranked", "rank", task.rank, rank, null, req.db);

        res.json({ id: Number(id), rank });
    } catch (err) {
        req.log.error({ err }, "Error ranking task:");
        res.status(500).json({ error: "Failed to reorder task" });
    }
});

export = router;
