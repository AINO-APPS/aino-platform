import { availableProjectTypes } from "../modules/tasks/tasks.projectTypes";
// Project CRUD — Stage 3.
//
//   GET    /api/projects             — list (active by default; `?include_archived=1`)
//   POST   /api/projects             — create (team lead+)
//   GET    /api/projects/:id         — single project
//   PUT    /api/projects/:id         — update (project admin)
//   PATCH  /api/projects/:id/archive — archive (project admin), unarchive (org admin)
//   DELETE /api/projects/:id         — delete (super_admin only, never had tickets)
//   GET    /api/projects/:id/tasks   — list tasks in this project

import express from "express";
import type { Request, Response } from "express";
const auth = require("../middleware/auth");
const { loadUserContext, requireRole } = require("../middleware/rbac");
const { requireTenant } = require("../middleware/tenant");
import { isFeatureEnabled } from "../utils/planCatalog";
import { changeProjectType, projectPlanningResponse, ProjectTypeError, validateNewProjectType } from "../modules/tasks/tasks.projectTypeLifecycle";
import { projectSprintStatuses } from "../modules/tasks/tasks.projectTypeRepository";
const { logAction } = require("../utils/audit");
const { enrichTasks } = require("./tasks/_helpers/enrich");
const { taskActorFromRequest, isOrgAdmin } = require("../modules/tasks/tasks.policy");
import { createProjectAccess, projectCapabilities } from "../modules/tasks/tasks.projectAccess";
import { changeProjectKey, ProjectKeyError } from "../modules/tasks/tasks.projectKey";
import { broadcast } from "../realtime/fanout";
import {
    createProjectWithGrants,
    findProjectById,
    listProjectMembers,
    listActiveProjects,
    ProjectAccessRepositoryError,
    removeProjectMember,
    updateProjectMemberRole,
    upsertProjectMember,
} from "../modules/tasks/tasks.projectAccessRepository";

const router = express.Router();
router.use(requireTenant);
router.use(require("./projectBoard"));

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
    const capabilities = await projectAccessForRequest(req).capabilities(Number(project.id), project.is_archived);
    const statuses = await projectSprintStatuses(req.db!, [Number(project.id)]);
    return projectPlanningResponse(project, capabilities, isFeatureEnabled((req.tenant ?? null) as any, "agile"), statuses.get(Number(project.id)) ?? []);
}

async function addCapabilitiesToProjects(req: Request, projects: any[]): Promise<any[]> {
    const access = projectAccessForRequest(req);
    const byProject = await access.capabilitiesForProjects(projects.map((project) => Number(project.id)));
    const statuses = await projectSprintStatuses(req.db!, projects.map((project) => Number(project.id)));
    return projects.map((project) => projectPlanningResponse(project,
        project.is_archived
            ? { ...(byProject.get(Number(project.id)) ?? projectCapabilities(null)), canCreateTickets: false, canEditWorkflow: false, canRenameKey: false, canArchive: false, canChangeType: false }
            : byProject.get(Number(project.id)) ?? projectCapabilities(null),
        isFeatureEnabled((req.tenant ?? null) as any, "agile"), statuses.get(Number(project.id)) ?? []));
}

function memberRole(value: unknown): "project_admin" | "member" | "viewer" | null {
    return typeof value === "string" && PROJECT_ROLES.has(value)
        ? value as "project_admin" | "member" | "viewer"
        : null;
}

function sendProjectAccessError(res: Response, err: unknown): boolean {
    if ((err as any)?.code === "23514" && (err as any)?.message === "PROJECT_HAS_OPEN_SPRINTS") {
        res.status(409).json({ error: "Complete or remove every planned, active or paused sprint before leaving Scrum.", code: "PROJECT_HAS_OPEN_SPRINTS" });
        return true;
    }
    if (err instanceof ProjectTypeError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return true;
    }
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

router.get("/types", auth, loadUserContext, (req: Request, res: Response) => {
    const agile = isFeatureEnabled((req.tenant ?? null) as any, "agile");
    res.json({ availableTypes: availableProjectTypes(agile), defaultType: agile ? "scrum" : "task_list" });
});

// ─── List projects in the requester's org ─────────────────────────────────
router.get("/mine", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        if (!req.userOrgId) return res.json([]);
        const projects = await addCapabilitiesToProjects(req, await listActiveProjects(req.db!, req.userOrgId));
        return res.json(projects.filter((project) => project.capabilities.canCreateTickets));
    } catch (err) {
        req.log.error({ err }, "Failed to list my projects");
        return res.status(500).json({ error: "Failed to list my projects" });
    }
});

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

        const accessibleIds = req.projectOwnership
            ? await projectAccessForRequest(req).accessibleProjectIds() : null;
        const listParams = [req.userOrgId, accessibleIds];
        const baseWhere = `WHERE p.org_id = $1
            AND ($2::int[] IS NULL OR p.id = ANY($2::int[]))
            ${includeArchived ? "" : "AND p.is_archived = FALSE"}`;
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
                listParams
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
                   LIMIT $3 OFFSET $4`,
                [...listParams, limit, offset]
            ),
            req.db!.query(`SELECT COUNT(*)::int AS total FROM projects p ${baseWhere}`, listParams),
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
        const type = validateNewProjectType(req.body?.type, isFeatureEnabled((req.tenant ?? null) as any, "agile"));
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
            type,
        });
        logAction(req, "create", "project", inserted.id, { key: upperKey, name: inserted.name });
        res.json(projectPlanningResponse(inserted, projectCapabilities("project_admin"), isFeatureEnabled((req.tenant ?? null) as any, "agile"), []));
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
router.put("/:id", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid project id" });
        const existing = (await req.db!.query("SELECT * FROM projects WHERE id = $1 AND org_id = $2", [id, req.userOrgId])).rows[0];
        if (!existing) return res.status(404).json({ error: "Project not found" });
        if (!await projectAccessForRequest(req).allows(id, "administer")) return res.status(403).json({ error: "Only project admins can edit projects" });
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
        const updated = await req.db!.transaction!(async (client: any) => {
            if (req.body?.type !== undefined) {
                await changeProjectType({ query: client.query.bind(client), transaction: async (fn) => fn(client) }, {
                    userId: Number(req.userId), orgId: req.userOrgId ?? null, orgRole: req.userRole ?? null,
                    teamIds: (req as any).userTeamIds ?? (req.userTeamId == null ? [] : [Number(req.userTeamId)]),
                }, id, req.body.type, isFeatureEnabled((req.tenant ?? null) as any, "agile"));
            }
            return (await client.query(
            `UPDATE projects
                SET name = $1, description = $2, color = $3, lead_user_id = $4, updated_at = NOW()
              WHERE id = $5
              RETURNING *`,
            [newName, newDesc, newColor, newLead, id]
        )).rows[0];
        });
        try { broadcast(req.tenantId == null ? null : Number(req.tenantId), "project_updated", { project_id: id }); }
        catch (err) { req.log.error({ err }, "Project committed but realtime delivery failed"); }
        logAction(req, "update", "project", id, { name: newName });
        res.json(await addProjectCapabilities(req, updated));
    } catch (err) {
        if (sendProjectAccessError(res, err)) return;
        req.log.error({ err }, "Failed to update project");
        res.status(500).json({ error: "Failed to update project" });
    }
});

// ─── Archive / unarchive ─────────────────────────────────────────────────
router.patch("/:id/archive", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid project id" });
        const archived = !!req.body?.is_archived;
        const existing = await findProjectById(req.db as any, id, Number(req.userOrgId));
        if (!existing) return res.status(404).json({ error: "Project not found" });
        if (archived ? !await projectAccessForRequest(req).allows(id, "administer") : !isOrgAdmin(req.userRole)) {
            return res.status(403).json({ error: archived ? "Only project admins can archive" : "Only org admins can unarchive", code: "ACCESS_DENIED" });
        }
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
// The persistent history bit survives ticket moves and deletion.
router.delete("/:id", auth, loadUserContext, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid project id" });
        const result = await (req.db as unknown as DbLike).transaction(async (client) => {
            const existing = (await client.query("SELECT key, has_had_tickets FROM projects WHERE id = $1 AND org_id = $2 FOR UPDATE", [id, req.userOrgId])).rows[0];
            if (!existing) return { status: 404, body: { error: "Project not found" } };
            const count = (await client.query("SELECT COUNT(*)::int AS c FROM tasks WHERE project_id = $1", [id])).rows[0].c;
            if (existing.has_had_tickets || count > 0) return { status: 409, body: { error: "Cannot delete a project that has had tickets. Archive it instead.", code: "PROJECT_NOT_EMPTY" } };
            await client.query("INSERT INTO reserved_project_keys (org_id, key, reason) VALUES ($1, $2, 'delete') ON CONFLICT DO NOTHING", [req.userOrgId, existing.key]);
            await client.query("DELETE FROM projects WHERE id = $1", [id]);
            return { status: 200, body: { ok: true, detached_tasks: 0 } };
        });
        if (result.status === 200) logAction(req, "delete", "project", id, null);
        res.status(result.status).json(result.body);
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