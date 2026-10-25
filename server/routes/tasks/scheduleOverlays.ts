// Calendar overlays.
//   GET /api/tasks/schedule-overlays?from=&to=
//
// Read-only context behind the Schedule calendar: approved leave, holidays and
// booked meetings. Overlays never affect task counts or point totals.

import express from "express";
import type { Request, Response } from "express";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");

const router = express.Router();

const DATE = /^\d{4}-\d{2}-\d{2}$/;

router.get("/schedule-overlays", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const { from, to } = req.query as { from?: string; to?: string };
        if (!from || !to || !DATE.test(from) || !DATE.test(to)) {
            return res.status(400).json({ error: "from and to must be YYYY-MM-DD" });
        }

        const [leave, holidays, meetings] = await Promise.all([
            req.db!.query(
                `SELECT l.id, l.user_id, l.date, l.end_date, l.leave_type, l.status,
                        u.full_name AS user_name
                   FROM leaves l
                   LEFT JOIN users u ON u.id = l.user_id
                  WHERE l.status = 'approved'
                    AND l.date <= $2
                    AND COALESCE(l.end_date, l.date) >= $1`,
                [from, to],
            ),
            req.db!.query(
                `SELECT id, name, date FROM holidays
                  WHERE date >= $1 AND date <= $2
                  ORDER BY date ASC`,
                [from, to],
            ).catch(() => ({ rows: [] })),
            req.db!.query(
                `SELECT id, title, start_time, end_time FROM calendar_events
                  WHERE start_time >= $1::date AND start_time < ($2::date + INTERVAL '1 day')
                  ORDER BY start_time ASC`,
                [from, to],
            ).catch(() => ({ rows: [] })),
        ]);

        res.json({
            leave: leave.rows,
            holidays: holidays.rows,
            meetings: meetings.rows,
        });
    } catch (err) {
        req.log.error({ err }, "Error fetching schedule overlays:");
        res.status(500).json({ error: "Failed to fetch schedule overlays" });
    }
});

export = router;
