// Calendar overlays.
//   GET /api/tasks/schedule-overlays?from=&to=
//
// Read-only context behind the Schedule calendar: approved leave, holidays and
// booked meetings. Overlays never affect task counts or point totals.

import express from "express";
import type { Request, Response } from "express";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");
const { findScheduleOverlays } = require("../../modules/tasks/tasks.schedule");

const router = express.Router();

const DATE = /^\d{4}-\d{2}-\d{2}$/;

router.get("/schedule-overlays", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const { from, to } = req.query as { from?: string; to?: string };
        if (!from || !to || !DATE.test(from) || !DATE.test(to)) {
            return res.status(400).json({ error: "from and to must be YYYY-MM-DD" });
        }

        res.json(await findScheduleOverlays(req.db!, from, to));
    } catch (err) {
        req.log.error({ err }, "Error fetching schedule overlays:");
        res.status(500).json({ error: "Failed to fetch schedule overlays" });
    }
});

export = router;
