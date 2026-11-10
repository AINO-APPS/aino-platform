import express from "express";
import type { Request, Response } from "express";
import { webOnly } from "../middleware/webOnly";
import { getMigrationReview, MigrationReviewError, switchProjectOwnership } from "../modules/tasks/tasks.migration";
const auth = require("../middleware/auth");
const { loadUserContext } = require("../middleware/rbac");

const router = express.Router();
router.use(webOnly, auth, loadUserContext);

function failure(req: Request, res: Response, error: unknown) {
    if (error instanceof MigrationReviewError) {
        return res.status(error.status).json({ error: error.message, code: error.code });
    }
    req.log?.error({ err: error }, "Project migration operation failed");
    return res.status(500).json({ error: "Project migration operation failed" });
}

router.get("/review", async (req: Request, res: Response) => {
    if (!["super_admin", "platform_admin"].includes(req.userRole ?? "")) {
        return res.status(403).json({ error: "Organization administrator required" });
    }
    if (!req.userOrgId) return res.status(404).json({ error: "Organization not found" });
    try {
        return res.json(await getMigrationReview(req.db!, req.userOrgId));
    } catch (error) { return failure(req, res, error); }
});

function switchHandler(enabled: boolean, role: string) {
    return async (req: Request, res: Response) => {
        if (req.userRole !== role) return res.status(403).json({ error: `${role} required` });
        if (!req.userOrgId) return res.status(404).json({ error: "Organization not found" });
        try {
            return res.json(await switchProjectOwnership(req.db!, req.userOrgId, Number(req.userId), enabled));
        } catch (error) { return failure(req, res, error); }
    };
}

router.post("/switch", switchHandler(true, "super_admin"));
router.post("/switch-back", switchHandler(false, "platform_admin"));

export = router;
