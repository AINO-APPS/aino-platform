// Search endpoints for tasks.
//
//   GET /search            — global cross-date search scoped to user
//   GET /lookup/quicksearch — autocomplete for dependency picker

import express from "express";
import type { Request, Response } from "express";
const auth = require('../../middleware/auth');
const { loadUserContext } = require('../../middleware/rbac');

const { enrichTasks, enrichTaskSummaries } = require('./_helpers/enrich');
const {
    buildVisibilityPredicate,
    resolveTaskVisibility,
    resolveTaskVisibilityForRequest,
    taskActorFromRequest,
} = require('../../modules/tasks/tasks.policy');
const { parseIssueKey, resolveIssueKeys } = require("./_helpers/issueKey");

const router = express.Router();

// ─── Global search across all dates + backlog ────────────────────────────
router.get('/search', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const { q } = req.query as Record<string, string>;
        if (!q || !q.trim() || q.trim().length < 2) return res.json([]);

        const escapedQ = q.trim().replace(/[%_]/g, c => `\\${c}`);
        const params: unknown[] = [`%${escapedQ}%`];
        let pi = 2;

        const scope: string[] = [];
        if (req.userOrgId) {
            scope.push(`t.org_id = $${pi++}`);
            params.push(req.userOrgId);
        } else {
            scope.push('t.org_id IS NULL');
        }

        // The same visibility boundary as every other list: a member searches
        // the team's tickets, an admin the org, a no-team user their own.
        // With the flag off, search keeps its original personal scope.
        const actor = taskActorFromRequest(req);
        const projectId = req.query.project_id != null
            ? Number.parseInt(String(req.query.project_id), 10)
            : null;
        const visibility = buildVisibilityPredicate(
            actor.projectOwnership
                ? await resolveTaskVisibilityForRequest(actor, { projectId })
                : actor.teamVisibility
                    ? resolveTaskVisibility(actor)
                : { kind: "personal", userId: actor.userId },
            pi,
        );
        if (visibility.sql) scope.push(visibility.sql);
        params.push(...visibility.params);
        pi = visibility.nextIndex;

        // Current keys and former keys resolve through the same key lookup
        // used by direct navigation and GitHub code-reference linking.
        const key = parseIssueKey(q.trim());
        const matches = key ? await resolveIssueKeys([key], req.userOrgId, req.db) : [];
        let keyCondition = 'FALSE';
        let keyRank = '1';
        if (matches.length) {
            keyCondition = `t.id = $${pi}`;
            keyRank = `CASE WHEN ${keyCondition} THEN 0 ELSE 1 END`;
            params.push(matches[0].task_id);
            pi += 1;
        }
        scope.push(`(t.title ILIKE $1 OR t.description ILIKE $1 OR ${keyCondition})`);

        const tasks = (await req.db!.query(`
            SELECT t.* FROM tasks t
            WHERE ${scope.join(' AND ')}
            ORDER BY ${keyRank}, t.created_at DESC
            LIMIT 20
        `, params)).rows;

        const enriched = await enrichTasks(tasks, req.db, actor);
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
        // The dependency picker must not leak another team's ticket titles.
        // Flag off keeps the historical personal scope (it was org-wide, which
        // leaked — tightening it is the safer reading of "old behaviour").
        const actor = taskActorFromRequest(req);
        const projectId = req.query.project_id != null
            ? Number.parseInt(String(req.query.project_id), 10)
            : null;
        const visibility = buildVisibilityPredicate(
            actor.projectOwnership
                ? await resolveTaskVisibilityForRequest(actor, { projectId })
                : actor.teamVisibility
                    ? resolveTaskVisibility(actor)
                : { kind: "personal", userId: actor.userId },
            4,
        );
        const rows = (await req.db!.query(
            `SELECT t.id, t.title, t.workflow_state_id, t.is_blocked, t.story_points,
                    t.work_item_type_id, t.user_id, t.assigned_to, t.team_id, t.org_id,
                    t.sprint_id, t.planned_date, t.completed_at
               FROM tasks t
              WHERE t.org_id = $1
                AND (
                    ($3::int IS NOT NULL AND t.id = $3::int)
                    OR t.title ILIKE $2
                )
                ${visibility.sql ? `AND ${visibility.sql}` : ''}
              ORDER BY t.id DESC
              LIMIT 20`,
            [req.userOrgId, `%${q}%`, numericId, ...visibility.params]
        )).rows;
        const enriched = await enrichTaskSummaries(rows, req.db, actor);
        res.json({
            tasks: enriched.map((task: any) => ({
                id: task.id,
                title: task.title,
                workflow_state_id: task.workflow_state_id,
                is_blocked: task.is_blocked,
                story_points: task.story_points,
                work_item_type_id: task.work_item_type_id,
                container: task.container,
                capabilities: task.capabilities,
            })),
        });
    } catch (err) {
        req.log.error({ err }, 'Error in quicksearch');
        res.status(500).json({ error: 'Failed to search tasks' });
    }
});

export = router;