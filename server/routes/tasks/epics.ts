// Epic rollups.
//   GET /api/tasks/epics — every epic with completed/total in count and points
//
// An epic is a task whose work item type has `is_epic = true`. Its children are
// the tasks pointing at it through `parent_task_id`.

import express from "express";
import type { Request, Response } from "express";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");
const { findEpics, findEpicRollups } = require("../../modules/tasks/tasks.repository");

const router = express.Router();

interface EpicRollupRow {
    parent_task_id: number;
    total_children: number;
    done_children: number;
    total_points: number;
    done_points: number;
}

router.get("/epics", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const epics = await findEpics(req.db!, req.userOrgId);

        if (epics.length === 0) return res.json({ epics: [] });

        const rollups: EpicRollupRow[] = await findEpicRollups(
            req.db!,
            req.userOrgId,
            epics.map((epic: any) => epic.id),
        );

        const byEpic = new Map<number, EpicRollupRow>(
            rollups.map((row) => [row.parent_task_id, row]),
        );

        res.json({
            epics: epics.map((epic: any) => {
                const rollup = byEpic.get(epic.id) || {
                    parent_task_id: epic.id,
                    total_children: 0,
                    done_children: 0,
                    total_points: 0,
                    done_points: 0,
                };
                const totalPoints = Number(rollup.total_points) || 0;
                const donePoints = Number(rollup.done_points) || 0;
                return {
                    ...epic,
                    rollup: {
                        totalChildren: rollup.total_children,
                        doneChildren: rollup.done_children,
                        totalPoints,
                        donePoints,
                        percentByPoints: totalPoints
                            ? Math.round((donePoints / totalPoints) * 100)
                            : 0,
                        percentByCount: rollup.total_children
                            ? Math.round((rollup.done_children / rollup.total_children) * 100)
                            : 0,
                    },
                };
            }),
        });
    } catch (err) {
        req.log.error({ err }, "Error fetching epics:");
        res.status(500).json({ error: "Failed to fetch epics" });
    }
});

export = router;
