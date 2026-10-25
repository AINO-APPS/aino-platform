// Per-user Tasks preferences.
//   GET /api/user/preferences  — read the stored preferences
//   PUT /api/user/preferences  — merge a partial update
//
// Stored server-side so web, desktop, Android and iOS agree for the same user.

import express from "express";
import type { Request, Response } from "express";
const auth = require("../middleware/auth");
const {
    DEFAULT_TASK_PREFERENCES,
    mergeTaskPreferences,
    normaliseTaskPreferences,
} = require("../modules/tasks/tasks.preferences");

const router = express.Router();

async function readPreferences(req: Request): Promise<unknown> {
    const row = (await req.db!.query(
        "SELECT task_prefs FROM users WHERE id = $1",
        [req.userId],
    )).rows[0];
    return row?.task_prefs ?? DEFAULT_TASK_PREFERENCES;
}

router.get("/", auth, async (req: Request, res: Response) => {
    try {
        res.json(normaliseTaskPreferences(await readPreferences(req)));
    } catch (err) {
        // A tenant that has not run the migration yet still gets usable
        // defaults rather than a 500.
        req.log.warn({ err }, "GET /user/preferences: returning defaults");
        res.json(DEFAULT_TASK_PREFERENCES);
    }
});

router.put("/", auth, async (req: Request, res: Response) => {
    try {
        const merged = mergeTaskPreferences(await readPreferences(req), req.body);
        await req.db!.query(
            "UPDATE users SET task_prefs = $1::jsonb WHERE id = $2",
            [JSON.stringify(merged), req.userId],
        );
        res.json(merged);
    } catch (err) {
        req.log.error({ err }, "PUT /user/preferences error");
        res.status(500).json({ error: "Failed to save preferences" });
    }
});

export = router;
