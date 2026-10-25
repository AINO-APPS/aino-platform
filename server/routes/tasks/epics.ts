// Epic rollups.
//   GET /api/tasks/epics — every epic with completed/total in count and points
//
// An epic is a task whose work item type has `is_epic = true`. Its children are
// the tasks pointing at it through `parent_task_id`.

import express from "express";
import type { Request, Response } from "express";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");

const router = express.Router();

router.get("/epics", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const epics = (await req.db!.query(
            `SELECT t.id, t.title, t.issue_key, t.workflow_state_id, t.story_points,
                    t.project_id, wit.name AS type_name, wit.color AS type_color
               FROM tasks t
               JOIN work_item_types wit ON wit.id = t.work_item_type_id
              WHERE t.org_id = $1 AND wit.is_epic = TRUE
              ORDER BY t.created_at ASC`,
            [req.userOrgId],
        )).rows;

        if (epics.length === 0) return res.json({ epics: [] });

        const rollups = (await req.db!.query(
            `SELECT t.parent_task_id,
                    COUNT(*)::int AS total_children,
                    COUNT(*) FILTER (WHERE t.completed_at IS NOT NULL)::int AS done_children,
                    COALESCE(SUM(t.story_points), 0)::float AS total_points,
                    COALESCE(SUM(t.story_points) FILTER (WHERE t.completed_at IS NOT NULL), 0)::float AS done_points
               FROM tasks t
              WHERE t.org_id = $1 AND t.parent_task_id = ANY($2::int[])
              GROUP BY t.parent_task_id`,
            [req.userOrgId, epics.map((epic: any) => epic.id)],
        )).rows;

        const byEpic = new Map(rollups.map((row: any) => [row.parent_task_id, row]));

        res.json({
            epics: epics.map((epic: any) => {
                const rollup = byEpic.get(epic.id) || {
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
