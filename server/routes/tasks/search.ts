// Search endpoints for tasks.
//
//   GET /search            — global cross-date search scoped to user
//   GET /lookup/quicksearch — autocomplete for dependency picker

import express from "express";
import type { Request, Response } from "express";
const auth = require('../../middleware/auth');
const { loadUserContext } = require('../../middleware/rbac');

const { enrichTasks } = require('./_helpers/enrich');

const router = express.Router();

// ─── Global search across all dates + backlog ────────────────────────────
router.get('/search', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const { q } = req.query as Record<string, string>;
        if (!q || !q.trim() || q.trim().length < 2) return res.json([]);

        const escapedQ = q.trim().replace(/[%_]/g, c => `\\${c}`);
        const params: unknown[] = [`%${escapedQ}%`];
        let pi = 2;

        const scope: string[] = ['(t.title ILIKE $1 OR t.description ILIKE $1)'];
        if (req.userOrgId) {
            scope.push(`t.org_id = $${pi++}`);
            params.push(req.userOrgId);
        } else {
            scope.push('t.org_id IS NULL');
        }
        // Restrict search scope: own tasks + assigned to me.
        scope.push(`(t.user_id = $${pi} OR t.assigned_to = $${pi})`);
        params.push(req.userId);
        pi++;

        // A key like PROJ-123 resolves to exactly one task and ranks first.
        const keyMatch = q.trim().match(/^([A-Za-z][A-Za-z0-9_]{1,9})-(\d+)$/);
        let keyCondition = 'FALSE';
        let keyRank = '1';
        if (keyMatch) {
            keyCondition = `(p.key = $${pi} AND t.task_number = $${pi + 1})`;
            keyRank = `CASE WHEN ${keyCondition} THEN 0 ELSE 1 END`;
            params.push(keyMatch[1].toUpperCase(), Number.parseInt(keyMatch[2], 10));
            pi += 2;
        }

        const tasks = (await req.db!.query(`
            SELECT t.* FROM tasks t
            LEFT JOIN projects p ON p.id = t.project_id
            WHERE (${scope.join(' AND ')}) OR ${keyCondition}
            ORDER BY ${keyRank}, t.created_at DESC
            LIMIT 20
        `, params)).rows;

        const enriched = await enrichTasks(tasks, req.db);
        res.json(enriched);
    } catch (err) {
        req.log.error({ err: err }, 'Error in global search:');
        res.status(500).json({ error: 'Search failed' });
    }
});

// ── Task quicksearch (lightweight, used by the dependency picker) ─────────
// Returns up to 20 tasks matching `q` in title or id, scoped to the org.
router.get('/lookup/quicksearch', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const q = String(req.query.q || '').trim();
        if (q.length < 1) return res.json({ tasks: [] });
        const numericId = /^\d+$/.test(q) ? parseInt(q, 10) : null;
        // PostgreSQL cannot infer the type of a NULL parameter when used in a
        // comparison without context, so we cast both occurrences of $3 to int.
        // Without these casts the driver throws "could not determine data type
        // of parameter $3" → 500 to the client when the search term isn't a
        // pure number (e.g. "test").
        //
        // Bug #8 (Stage 2): we used to filter on `u.org_id` from the joined
        // creator. If the creator moved orgs but the task stayed (`tasks.org_id`
        // is the canonical column), the task disappeared from search. Filter
        // on `t.org_id` directly. We still join users only to keep the column
        // list compatible for future enrichment, but it's no longer the gate.
        const rows = (await req.db!.query(
            `SELECT t.id, t.title, t.status, t.workflow_state_id, t.is_blocked, t.story_points,
                    t.work_item_type_id
               FROM tasks t
              WHERE t.org_id = $1
                AND (
                    ($3::int IS NOT NULL AND t.id = $3::int)
                    OR t.title ILIKE $2
                )
              ORDER BY t.id DESC
              LIMIT 20`,
            [req.userOrgId, `%${q}%`, numericId]
        )).rows;
        res.json({ tasks: rows });
    } catch (err) {
        req.log.error({ err }, 'Error in quicksearch');
        res.status(500).json({ error: 'Failed to search tasks' });
    }
});

export = router;