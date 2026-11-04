// Project CRUD — Stage 3.
//
//   GET    /api/projects             — list (active by default; `?include_archived=1`)
//   POST   /api/projects             — create (team lead+)
//   GET    /api/projects/:id         — single project
//   PUT    /api/projects/:id         — update (manager+)
//   PATCH  /api/projects/:id/archive — archive / unarchive (manager+)
//   DELETE /api/projects/:id         — delete (super_admin only, only if empty)
//   GET    /api/projects/:id/tasks   — list tasks in this project

import express from "express";
import type { Request, Response } from "express";
const auth = require("../middleware/auth");
const { loadUserContext, requireRole } = require("../middleware/rbac");
const { requireTenant, requireFeature } = require("../middleware/tenant");
const { logAction } = require("../utils/audit");
const { enrichTasks } = require("./tasks/_helpers/enrich");
const { taskActorFromRequest } = require("../modules/tasks/tasks.policy");
import { createProjectAccess } from "../modules/tasks/tasks.projectAccess";
import { changeProjectKey, ProjectKeyError } from "../modules/tasks/tasks.projectKey";
import { broadcast } from "../realtime/fanout";
import {
    createProjectWithGrants,
    findProjectById,
    listProjectMembers,
    ProjectAccessRepositoryError,
    removeProjectMember,
    updateProjectMemberRole,
    upsertProjectMember,
} from "../modules/tasks/tasks.projectAccessRepository";

const router = express.Router();
// Projects are part of the Agile feature bundle — same gate as /api/agile
// and /api/sprints. Without this, a Standard-plan tenant could create
// projects through the API even though the UI hides the section.
router.use(requireTenant, requireFeature("agile"));

interface DbLike {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;
    transaction: <T = unknown>(fn: (client: any) => Promise<T>) => Promise<T>;
}

const KEY_RE = /^[A-Z][A-Z0-9_]{1,9}$/;
const PROJECT_ROLES = new Set(["project_admin", "member", "viewer"]);

function projectAccessForRequest(req: Request) {
    const request = req as any;
    const teamIds = Array.isArray(request.userTeamIds)
        ? request.userTeamIds.map(Number).filter(Number.isInteger)
        : request.userTeamId == null ? undefined : [Number(request.userTeamId)];
    return createProjectAccess(req.db as any, {
        userId: Number(request.userId),
        orgId: request.userOrgId ?? null,
        orgRole: request.userRole ?? null,
        teamIds,
    });
}

async function addProjectCapabilities(req: Request, project: any): Promise<any> {
    const capabilities = await projectAccessForRequest(req).capabilities(Number(project.id));
    return { ...project, capabilities };
}

async function addCapabilitiesToProjects(req: Request, projects: any[]): Promise<any[]> {
    const access = projectAccessForRequest(req);
    const byProject = await access.capabilitiesForProjects(projects.map((project) => Number(project.id)));
    return projects.map((project) => ({
        ...project,
        capabilities: byProject.get(Number(project.id)) ?? { canAdminister: false, canManageMembers: false, canRenameKey: false },
    }));
}

function memberRole(value: unknown): "project_admin" | "member" | "viewer" | null {
    return typeof value === "string" && PROJECT_ROLES.has(value)
        ? value as "project_admin" | "member" | "viewer"
        : null;
}

function sendProjectAccessError(res: Response, err: unknown): boolean {
    if (!(err instanceof ProjectAccessRepositoryError)) return false;
    if (err.code === "PROJECT_NOT_FOUND") {
        res.status(404).json({ error: err.message, code: err.code });
    } else if (err.code === "LAST_PROJECT_ADMIN") {
        res.status(409).json({ error: err.message, code: err.code });
    } else {
        res.status(400).json({ error: err.message, code: err.code });
    }
    return true;
}

// ─── List projects in the requester's org ─────────────────────────────────
//
// Returns a plain array by default (back-compat with callers that expected
// the original shape). When `?paginate=1` is supplied, returns
// `{ projects, pagination: { limit, offset, total, hasMore } }` so the
// Projects admin page can render page controls without a second round-trip
// for the total count.
router.get("/", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const paginate = req.query.paginate === "1";
        if (!req.userOrgId) {
            return paginate
                ? res.json({ projects: [], pagination: { limit: 0, offset: 0, total: 0, hasMore: false } })
                : res.json([]);
        }
        const includeArchived = req.query.include_archived === "1";
        // Sensible caps — page sizes much above 200 defeat the purpose.
        const limit = Math.max(1, Math.min(200, parseInt(String(req.query.limit), 10) || 50));
        const offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);

        const baseWhere = `WHERE p.org_id = $1 ${includeArchived ? "" : "AND p.is_archived = FALSE"}`;
        const orderBy = "ORDER BY p.is_archived ASC, LOWER(p.name) ASC";

        if (!paginate) {
            // Legacy mode — return every matching row as a plain array.
            const rows = (await req.db!.query(
                `SELECT p.*, u.full_name AS lead_name, u.username AS lead_username,
                        (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id) AS task_count
                   FROM projects p
              LEFT JOIN users u ON u.id = p.lead_user_id
                   ${baseWhere}
                   ${orderBy}`,
                [req.userOrgId]
            )).rows;
            return res.json(await addCapabilitiesToProjects(req, rows));
        }

        const [pageRes, countRes] = await Promise.all([
            req.db!.query(
                `SELECT p.*, u.full_name AS lead_name, u.username AS lead_username,
                        (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id) AS task_count
                   FROM projects p
              LEFT JOIN users u ON u.id = p.lead_user_id
                   ${baseWhere}
                   ${orderBy}
                   LIMIT $2 OFFSET $3`,
                [req.userOrgId, limit, offset]
            ),
            req.db!.query(`SELECT COUNT(*)::int AS total FROM projects p ${baseWhere}`, [req.userOrgId]),
        ]);
        const projects = await addCapabilitiesToProjects(req, pageRes.rows);
        const total = countRes.rows[0]?.total ?? projects.length;
        res.json({
            projects,
            pagination: { limit, offset, total, hasMore: offset + projects.length < total },
        });
    } catch (err) {
        req.log.error({ err }, "Failed to list projects");
        res.status(500).json({ error: "Failed to list projects" });
    }
});

// ─── Create project ──────────────────────────────────────────────────────
router.post("/", auth, loadUserContext, requireRole("team_lead"), async (req: Request, res: Response) => {
    try {
        if (!req.userOrgId) return res.status(400).json({ error: "Organization required" });
        const { key, name, description, color, lead_user_id, team_ids } = req.body || {};
        if (!name || !name.trim()) return res.status(400).json({ error: "Project name is required" });
        if (!key || !KEY_RE.test(String(key))) {
            return res.status(400).json({
                error: "Project key must be 2–10 uppercase letters/digits/underscores starting with a letter (e.g. PSSPMT).",
            });
        }
        const upperKey = String(key).toUpperCase();
        const dup = await req.db!.query("SELECT id FROM projects WHERE org_id = $1 AND key = $2", [req.userOrgId, upperKey]);
        if (dup.rowCount > 0) return res.status(409).json({ error: "A project with this key already exists" });
        if (team_ids !== undefined && (!Array.isArray(team_ids) || team_ids.some((id: unknown) => !/^\d+$/.test(String(id)) || Number(id) <= 0))) {
            return res.status(400).json({ error: "team_ids must be an array of positive team IDs" });
        }
        const validColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#6366f1";
        let validLead = null;
        if (lead_user_id) {
            const leadNum = parseInt(lead_user_id, 10);
            if (!isNaN(leadNum)) {
                const lead = (await req.db!.query("SELECT id FROM users WHERE id = $1 AND org_id = $2 AND is_active = TRUE", [leadNum, req.userOrgId])).rows[0];
                if (lead) validLead = lead.id;
            }
        }
        const inserted = await createProjectWithGrants(req.db as any, {
            orgId: Number(req.userOrgId),
            creatorId: Number(req.userId),
            key: upperKey,
            name: name.trim().slice(0, 200),
            description: typeof description === "string" ? description.slice(0, 2000) || null : null,
            color: validColor,
            leadUserId: validLead,
            teamIds: (team_ids ?? []).map(Number),
        });
        logAction(req, "create", "project", inserted.id, { key: upperKey, name: inserted.name });
        res.json({
            ...inserted,
            capabilities: { canAdminister: true, canManageMembers: true, canRenameKey: true },
        });
    } catch (err) {
        if (sendProjectAccessError(res, err)) return;
        if ((err as any)?.code === "23505") {
            return res.status(409).json({ error: "A project with this key already exists" });
        }
        req.log.error({ err }, "Failed to create project");
        res.status(500).json({ error: "Failed to create project" });
    }
});

// ─── Get one project ─────────────────────────────────────────────────────
router.get("/:id", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid project id" });
        const row = (await req.db!.query(
            `SELECT p.*, u.full_name AS lead_name, u.username AS lead_username,
                    (SELECT COUNT(*)::int FROM tasks WHERE project_id = p.id) AS task_count
               FROM projects p
          LEFT JOIN users u ON u.id = p.lead_user_id
              WHERE p.id = $1 AND p.org_id = $2`,
            [id, req.userOrgId]
        )).rows[0];
        if (!row) return res.status(404).json({ error: "Project not found" });
        res.json(await addProjectCapabilities(req, row));
    } catch (err) {
        req.log.error({ err }, "Failed to fetch project");
        res.status(500).json({ error: "Failed to fetch project" });
    }
});

async function renameProjectKey(req: Request, res: Response, preview: boolean) {
    try {
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid project id" });
        const request = req as any;
        const result = await changeProjectKey(req.db as any, {
            userId: Number(req.userId), orgId: req.userOrgId ?? null, orgRole: req.userRole ?? null,
            teamIds: request.userTeamIds ?? (request.userTeamId == null ? undefined : [Number(request.userTeamId)]),
        }, id, req.body?.key, preview);
        if (!preview) {
            try { broadcast(req.tenantId == null ? null : Number(req.tenantId), "project_updated", { project_id: result.project_id }); }
            catch (err) { req.log.error({ err }, "Project key committed but realtime delivery failed"); }
        }
        return res.json(result);
    } catch (err) {
        if (err instanceof ProjectKeyError) return res.status(err.status).json({ error: err.message, code: err.code });
        req.log.error({ err }, "Failed to rename project key");
        return res.status(500).json({ error: "Failed to rename project key" });
    }
}

router.post("/:id/key/preview", auth, loadUserContext, (req: Request, res: Response) => renameProjectKey(req, res, true));
router.post("/:id/key", auth, loadUserContext, (req: Request, res: Response) => renameProjectKey(req, res, false));

// ─── Project member grants ──────────────────────────────────────────────
router.get("/:id/members", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid project id" });
        if (!req.userOrgId) return res.status(404).json({ error: "Project not found" });
        const project = await findProjectById(req.db as any, id, Number(req.userOrgId));
        if (!project) return res.status(404).json({ error: "Project not found" });
        res.json(await listProjectMembers(req.db as any, id, Number(req.userOrgId)));
    } catch (err) {
        req.log.error({ err }, "Failed to list project members");
        res.status(500).json({ error: "Failed to list project members" });
    }
});

router.post("/:id/members", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        const role = memberRole(req.body?.role);
        const subjectType = req.body?.subject_type;
        const subjectId = Number(req.body?.subject_id);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid project id" });
        if (!req.userOrgId) return res.status(404).json({ error: "Project not found" });
        if (!role || !["user", "team"].includes(subjectType) || !Number.isInteger(subjectId) || subjectId <= 0) {
            return res.status(400).json({ error: "A valid subject_type, subject_id and project role are required" });
        }
        const access = projectAccessForRequest(req);
        if (!await access.allows(id, "manageMembers")) {
            const project = await findProjectById(req.db as any, id, Number(req.userOrgId));
            return project
                ? res.status(403).json({ error: "Only project admins can manage project members" })
                : res.status(404).json({ error: "Project not found" });
        }
        const member = await upsertProjectMember(req.db as any, {
            projectId: id,
            orgId: Number(req.userOrgId),
            grantedBy: Number(req.userId),
            subjectType,
            subjectId,
            role,
        });
        res.status(200).json(member);
    } catch (err) {
        if (sendProjectAccessError(res, err)) return;
        req.log.error({ err }, "Failed to grant project access");
        res.status(500).json({ error: "Failed to grant project access" });
    }
});

router.put("/:id/members/:memberId", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        const memberId = parseInt(String(req.params.memberId), 10);
        const role = memberRole(req.body?.role);
        if (isNaN(id) || isNaN(memberId)) return res.status(400).json({ error: "Invalid project or member id" });
        if (!role) return res.status(400).json({ error: "A valid project role is required" });
        if (!req.userOrgId) return res.status(404).json({ error: "Project not found" });
        const access = projectAccessForRequest(req);
        if (!await access.allows(id, "manageMembers")) {
            const project = await findProjectById(req.db as any, id, Number(req.userOrgId));
            return project
                ? res.status(403).json({ error: "Only project admins can manage project members" })
                : res.status(404).json({ error: "Project not found" });
        }
        const member = await updateProjectMemberRole(req.db as any, {
            projectId: id,
            orgId: Number(req.userOrgId),
            memberId,
            role,
            grantedBy: Number(req.userId),
        });
        res.json(member);
    } catch (err) {
        if (sendProjectAccessError(res, err)) return;
        req.log.error({ err }, "Failed to update project member");
        res.status(500).json({ error: "Failed to update project member" });
    }
});

router.delete("/:id/members/:memberId", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        const memberId = parseInt(String(req.params.memberId), 10);
        if (isNaN(id) || isNaN(memberId)) return res.status(400).json({ error: "Invalid project or member id" });
        if (!req.userOrgId) return res.status(404).json({ error: "Project not found" });
        const access = projectAccessForRequest(req);
        if (!await access.allows(id, "manageMembers")) {
            const project = await findProjectById(req.db as any, id, Number(req.userOrgId));
            return project
                ? res.status(403).json({ error: "Only project admins can manage project members" })
                : res.status(404).json({ error: "Project not found" });
        }
        await removeProjectMember(req.db as any, {
            projectId: id,
            orgId: Number(req.userOrgId),
            memberId,
        });
        res.json({ ok: true });
    } catch (err) {
        if (sendProjectAccessError(res, err)) return;
        req.log.error({ err }, "Failed to remove project member");
        res.status(500).json({ error: "Failed to remove project member" });
    }
});

// ─── Update project ──────────────────────────────────────────────────────
router.put("/:id", auth, loadUserContext, requireRole("manager"), async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid project id" });
        const existing = (await req.db!.query("SELECT * FROM projects WHERE id = $1 AND org_id = $2", [id, req.userOrgId])).rows[0];
        if (!existing) return res.status(404).json({ error: "Project not found" });
        // Key changes use the transactional key endpoint so old references survive.
        const { name, description, color, lead_user_id } = req.body || {};
        const newName = name?.trim() || existing.name;
        const newDesc = description !== undefined ? (description?.slice(0, 2000) || null) : existing.description;
        const newColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : existing.color;
        let newLead = existing.lead_user_id;
        if (lead_user_id !== undefined) {
            if (lead_user_id === null || lead_user_id === "") {
                newLead = null;
            } else {
                const leadNum = parseInt(lead_user_id, 10);
                if (!isNaN(leadNum)) {
                    const lead = (await req.db!.query("SELECT id FROM users WHERE id = $1 AND org_id = $2 AND is_active = TRUE", [leadNum, req.userOrgId])).rows[0];
                    if (lead) newLead = lead.id;
                }
            }
        }
        const updated = (await req.db!.query(
            `UPDATE projects
                SET name = $1, description = $2, color = $3, lead_user_id = $4, updated_at = NOW()
              WHERE id = $5
              RETURNING *`,
            [newName, newDesc, newColor, newLead, id]
        )).rows[0];
        logAction(req, "update", "project", id, { name: newName });
        res.json(await addProjectCapabilities(req, updated));
    } catch (err) {
        req.log.error({ err }, "Failed to update project");
        res.status(500).json({ error: "Failed to update project" });
    }
});

// ─── Archive / unarchive ─────────────────────────────────────────────────
router.patch("/:id/archive", auth, loadUserContext, requireRole("manager"), async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid project id" });
        const archived = !!req.body?.is_archived;
        const r = await req.db!.query(
            "UPDATE projects SET is_archived = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3 RETURNING *",
            [archived, id, req.userOrgId]
        );
        if (r.rowCount === 0) return res.status(404).json({ error: "Project not found" });
        logAction(req, archived ? "archive" : "unarchive", "project", id, null);
        res.json(await addProjectCapabilities(req, r.rows[0]));
    } catch (err) {
        req.log.error({ err }, "Failed to archive project");
        res.status(500).json({ error: "Failed to archive project" });
    }
});

// ─── Delete (super_admin only) ───────────────────────────────────────────
//
// By default the endpoint refuses if any tasks still belong to the project,
// to protect against accidental data loss. A super_admin can override that
// with `?force=1`, which detaches every task from the project (project_id
// and task_number set to NULL — the tickets themselves stay; only their
// issue key disappears). External references like branches/commits that
// already mention `PROJ-N` will of course no longer resolve, which is the
// whole reason we discourage this — but it's the right escape hatch when
// a project was created by mistake.
router.delete("/:id", auth, loadUserContext, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid project id" });
        const existing = (await req.db!.query("SELECT key FROM projects WHERE id = $1 AND org_id = $2", [id, req.userOrgId])).rows[0];
        if (!existing) return res.status(404).json({ error: "Project not found" });
        const force = req.query.force === "1" || req.body?.force === true;
        const taskCount = (await req.db!.query("SELECT COUNT(*)::int AS c FROM tasks WHERE project_id = $1", [id])).rows[0].c;
        if (taskCount > 0 && !force) {
            return res.status(409).json({
                error: `Cannot delete project: ${taskCount} task(s) still belong to it. Archive instead, or move/delete the tasks first, or retry with force=1 to detach them.`,
                task_count: taskCount,
                code: "PROJECT_NOT_EMPTY",
            });
        }
        // Wrap detach + delete in a single transaction so a failure between
        // them can't leave the project gone with task_number references still
        // pointing into nowhere.
        await (req.db as unknown as DbLike).transaction(async (client) => {
            if (taskCount > 0) {
                await client.query(
                    "UPDATE tasks SET project_id = NULL, task_number = NULL WHERE project_id = $1",
                    [id]
                );
            }
            await client.query("DELETE FROM projects WHERE id = $1", [id]);
        });
        logAction(req, "delete", "project", id, {
            key: existing.key,
            detached_tasks: taskCount,
            forced: force && taskCount > 0,
        });
        res.json({ ok: true, detached_tasks: taskCount });
    } catch (err) {
        req.log.error({ err }, "Failed to delete project");
        res.status(500).json({ error: "Failed to delete project" });
    }
});

// ─── Tasks in a project (paginated list) ─────────────────────────────────
router.get("/:id/tasks", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid project id" });
        const proj = (await req.db!.query("SELECT id FROM projects WHERE id = $1 AND org_id = $2", [id, req.userOrgId])).rows[0];
        if (!proj) return res.status(404).json({ error: "Project not found" });
        const limit = Math.max(1, Math.min(500, parseInt(String(req.query.limit), 10) || 25));
        const offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);
        const [tasksRes, countRes] = await Promise.all([
            req.db!.query(
                `SELECT t.* FROM tasks t
                  WHERE t.project_id = $1
                  ORDER BY t.task_number ASC NULLS LAST
                  LIMIT $2 OFFSET $3`,
                [id, limit, offset]
            ),
            req.db!.query(`SELECT COUNT(*)::int AS total FROM tasks WHERE project_id = $1`, [id]),
        ]);
        const tasks = tasksRes.rows;
        const total = countRes.rows[0]?.total ?? tasks.length;
        const enriched = await enrichTasks(tasks, req.db, taskActorFromRequest(req));
        res.json({
            tasks: enriched,
            pagination: { limit, offset, total, hasMore: offset + enriched.length < total },
        });
    } catch (err) {
        req.log.error({ err }, "Failed to list project tasks");
        res.status(500).json({ error: "Failed to list project tasks" });
    }
});

export = router;