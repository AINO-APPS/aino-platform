/** Compatibility composition adapter for the global search module. */
import express from "express";
import type { Request, Response } from "express";
import auth from "../middleware/auth";
import { loadUserContext, ROLE_LEVEL } from "../middleware/rbac";
import { requireTenant } from "../middleware/tenant";
import { isMobileClient } from "../middleware/webOnly";
import * as redis from "../redis";
import { createSearchService } from "../modules/search/search.service";
import type { SearchDb } from "../modules/search/search.types";
import { taskActorFromRequest } from "../modules/tasks/tasks.policy";
const { enrichTaskSummaries } = require("./tasks/_helpers/enrich");
const { parseIssueKey, resolveIssueKeys } = require("./tasks/_helpers/issueKey");

const router = express.Router();
const service = createSearchService({
    getCached: redis.getSearchCache,
    setCached: redis.setSearchCache,
});
router.use(auth, loadUserContext, requireTenant);

/**
 * GET /api/search?q=<term>
 * Returns matched tasks, notes, users, and audit logs grouped by type.
 * Minimum query length: 2 characters.
 */
router.get("/", async (req: Request, res: Response) => {
    try {
        const actor = taskActorFromRequest(req);
        const query = typeof req.query.q === "string" ? req.query.q : undefined;
        const key = parseIssueKey(query?.trim());
        const exactMatches = key
            ? await resolveIssueKeys([key], req.userOrgId, req.db)
            : [];
        const results = await service.search(req.db as unknown as SearchDb, {
            query,
            tenantId: req.tenantId == null ? null : Number(req.tenantId),
            ...actor,
            canReadAuditLogs: (ROLE_LEVEL[req.userRole as string] || 1) >= ROLE_LEVEL.hr_admin,
        }, exactMatches.map((match: { task_id: number }) => match.task_id));
        const tasks = await enrichTaskSummaries(results.tasks, req.db, actor);
        const enrichedResults = {
            ...results,
            tasks: tasks.map((task: any) => ({
                id: task.id,
                title: task.title,
                description: task.description,
                workflow_state_key: task.workflow_state_key,
                priority: task.priority,
                start_date: task.start_date,
                due_date: task.due_date,
                sprint_id: task.sprint_id,
                snippet: task.snippet,
                ticket_key: task.ticket_key,
                key_aliases: task.key_aliases,
                container: task.container,
                capabilities: task.capabilities,
            })),
        };
        // Audit logs are admin data and administration is web-only.
        res.json(isMobileClient(req) ? { ...enrichedResults, logs: [] } : enrichedResults);
    } catch (err) {
        req.log.error({ err }, "Global search error");
        res.status(500).json({ error: "Search failed" });
    }
});

export = router;