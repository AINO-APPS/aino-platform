/** Compatibility composition adapter for the global search module. */
import express from "express";
import type { Request, Response } from "express";
import auth from "../middleware/auth";
import { loadUserContext, ROLE_LEVEL } from "../middleware/rbac";
import { requireTenant } from "../middleware/tenant";
import * as redis from "../redis";
import { createSearchService } from "../modules/search/search.service";
import type { SearchDb } from "../modules/search/search.types";

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
        const results = await service.search(req.db as unknown as SearchDb, {
            query: typeof req.query.q === "string" ? req.query.q : undefined,
            tenantId: req.tenantId == null ? null : Number(req.tenantId),
            userId: req.userId!,
            orgId: req.userOrgId || null,
            canReadAuditLogs: (ROLE_LEVEL[req.userRole as string] || 1) >= ROLE_LEVEL.hr_admin,
        });
        res.json(results);
    } catch (err) {
        req.log.error({ err }, "Global search error");
        res.status(500).json({ error: "Search failed" });
    }
});

export = router;