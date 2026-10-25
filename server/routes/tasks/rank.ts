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
const { canAccessTask } = require("./_helpers/access");
const { rankForMove } = require("../../modules/tasks/tasks.rank");

const router = express.Router();

async function rankOf(req: Request, id: unknown): Promise<string | null> {
    if (id === null || id === undefined || id === "") return null;
    const parsed = Number.parseInt(String(id), 10);
    if (Number.isNaN(parsed)) return null;
    const row = (await req.db!.query(
        "SELECT rank FROM tasks WHERE id = $1 AND org_id = $2",
        [parsed, req.userOrgId],
    )).rows[0];
    return row?.rank ?? null;
}

router.patch("/:id/rank", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { beforeId, afterId } = req.body as { beforeId?: unknown; afterId?: unknown };

        const task = (await req.db!.query("SELECT * FROM tasks WHERE id = $1", [id])).rows[0];
        if (!await canAccessTask(task, req.userId, req.userOrgId, req.db, req.userRole)) {
            return res.status(404).json({ error: "Task not found" });
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

        await req.db!.query("UPDATE tasks SET rank = $1 WHERE id = $2", [rank, id]);
        await logHistory(id, req.userId, "ranked", "rank", task.rank, rank, null, req.db);

        res.json({ id: Number(id), rank });
    } catch (err) {
        req.log.error({ err }, "Error ranking task:");
        res.status(500).json({ error: "Failed to reorder task" });
    }
});

export = router;
