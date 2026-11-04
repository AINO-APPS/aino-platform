import express from "express";
import type { Request, Response } from "express";
import { createProjectAccess } from "../modules/tasks/tasks.projectAccess";
import { loadLifecycleContext, effectiveTransitionRows, seedProjectTransitions } from "../modules/tasks/tasks.workflow";
import {
    countTasksInWorkflowState,
    createProjectWorkflowState,
    deleteProjectWorkflowState,
    findProjectInOrg,
    findProjectWorkflowState,
    listActiveProjectWorkflowStates,
    listProjectWorkflowStates,
    missingProjectWorkflowCategories,
    reorderProjectWorkflowStates,
    replaceProjectWorkflowTransitions,
    setOtherProjectWorkflowStatesNonInitial,
    updateProjectWorkflowState,
    type WorkflowDb,
} from "../modules/tasks/tasks.projectWorkflowRepository";

const auth = require("../middleware/auth");
const { loadUserContext } = require("../middleware/rbac");
const { requireTenant, requireFeature } = require("../middleware/tenant");

const router = express.Router();
router.use(requireTenant, requireFeature("agile"), auth, loadUserContext);

const CATEGORIES = new Set(["open", "in_progress", "in_review", "done"]);
const REQUIRED_CATEGORIES = ["open", "in_progress", "in_review", "done"];

function actorAccess(req: Request) {
    const request = req as any;
    const teamIds = Array.isArray(request.userTeamIds)
        ? request.userTeamIds.map(Number).filter(Number.isInteger)
        : request.userTeamId == null ? undefined : [Number(request.userTeamId)];
    return createProjectAccess(req.db as any, {
        userId: Number(request.userId),
        orgId: req.userOrgId ?? null,
        orgRole: request.userRole ?? null,
        teamIds,
    });
}

async function loadProject(req: Request, projectId: number, write: boolean): Promise<"missing" | "forbidden" | "ok"> {
    if (!req.userOrgId) return "missing";
    const project = await findProjectInOrg(req.db as unknown as WorkflowDb, req.userOrgId, projectId);
    if (!project) return "missing";
    const access = actorAccess(req);
    const role = await access.roleForProject(projectId);
    if (!role) return "missing";
    if (write && !(await access.capabilities(projectId)).canEditWorkflow) return "forbidden";
    return "ok";
}

function projectIdFromRequest(req: Request): number | null {
    const id = Number.parseInt(String(req.params.id), 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function stateIdFromRequest(req: Request): number | null {
    const id = Number.parseInt(String(req.params.stateId), 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

function failAccess(res: Response, access: "missing" | "forbidden"): Response {
    return access === "forbidden"
        ? res.status(403).json({ error: "Project workflow access denied", code: "PROJECT_WORKFLOW_FORBIDDEN" })
        : res.status(404).json({ error: "Project not found" });
}

function slugify(value: unknown): string {
    return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

function color(value: unknown, fallback = "#6b7280"): string {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

router.get("/:id/workflow-states", async (req: Request, res: Response) => {
    const projectId = projectIdFromRequest(req);
    if (!projectId) return res.status(400).json({ error: "Invalid project id" });
    const access = await loadProject(req, projectId, false);
    if (access !== "ok") return failAccess(res, access);
    try {
        const states = await listProjectWorkflowStates(req.db as unknown as WorkflowDb, req.userOrgId!, projectId);
        const lifecycle = await loadLifecycleContext(req.db as any, req.userOrgId, projectId);
        res.json({
            workflowStates: states,
            transitions: effectiveTransitionRows(lifecycle),
            canEditWorkflow: (await actorAccess(req).capabilities(projectId)).canEditWorkflow,
        });
    } catch (err) {
        req.log.error({ err }, "Failed to load project workflow");
        res.status(500).json({ error: "Failed to load project workflow" });
    }
});

router.post("/:id/workflow-states", async (req: Request, res: Response) => {
    const projectId = projectIdFromRequest(req);
    if (!projectId) return res.status(400).json({ error: "Invalid project id" });
    const access = await loadProject(req, projectId, true);
    if (access !== "ok") return failAccess(res, access);
    const body = req.body ?? {};
    const name = String(body.name ?? "").trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: "Name is required" });
    if (!CATEGORIES.has(body.category)) return res.status(400).json({ error: "Invalid workflow category" });
    const key = slugify(body.key || name);
    if (!key || key === "cancelled") return res.status(400).json({ error: "Invalid workflow key" });
    try {
        const row = await createProjectWorkflowState(req.db as unknown as WorkflowDb, {
            orgId: req.userOrgId!,
            projectId,
            key,
            name,
            category: body.category,
            color: color(body.color),
            icon: body.icon ? String(body.icon).slice(0, 40) : null,
            wipLimit: body.wip_limit == null ? null : Number.parseInt(String(body.wip_limit), 10) || null,
            isInitial: !!body.is_initial,
            isTerminal: !!body.is_terminal,
        });
        await seedProjectTransitions(req.db as any, req.userOrgId, projectId, Number(row.id));
        return res.status(201).json(row);
    } catch (err: any) {
        if (err?.code === "23505") return res.status(409).json({ error: "A workflow state with this key already exists" });
        req.log.error({ err }, "Failed to create project workflow state");
        return res.status(500).json({ error: "Failed to create workflow state" });
    }
});

router.put("/:id/workflow-states/reorder", async (req: Request, res: Response) => {
    const projectId = projectIdFromRequest(req);
    if (!projectId) return res.status(400).json({ error: "Invalid project id" });
    const access = await loadProject(req, projectId, true);
    if (access !== "ok") return failAccess(res, access);
    const order = req.body?.order;
    if (!Array.isArray(order)) return res.status(400).json({ error: "order must be an array of state ids" });
    try {
        await reorderProjectWorkflowStates(req.db as unknown as WorkflowDb, projectId, order);
        return res.json({ message: "Order updated" });
    } catch (err) {
        req.log.error({ err }, "Failed to reorder project workflow");
        return res.status(500).json({ error: "Failed to reorder workflow states" });
    }
});

router.put("/:id/workflow-states/:stateId", async (req: Request, res: Response) => {
    const projectId = projectIdFromRequest(req);
    const stateId = stateIdFromRequest(req);
    if (!projectId || !stateId) return res.status(400).json({ error: "Invalid project or state id" });
    const access = await loadProject(req, projectId, true);
    if (access !== "ok") return failAccess(res, access);
    try {
        const existing = await findProjectWorkflowState(req.db as unknown as WorkflowDb, projectId, stateId);
        if (!existing) return res.status(404).json({ error: "Workflow state not found" });
        const body = req.body ?? {};
        const updates: Record<string, unknown> = {};
        const set = (column: string, value: unknown) => { updates[column] = value; };
        if (body.name !== undefined) set("name", String(body.name).trim().slice(0, 40));
        if (body.category !== undefined) {
            if (!CATEGORIES.has(body.category)) return res.status(400).json({ error: "Invalid workflow category" });
            set("category", body.category);
        }
        if (body.color !== undefined) set("color", color(body.color, existing.color));
        if (body.icon !== undefined) set("icon", body.icon ? String(body.icon).slice(0, 40) : null);
        if (body.wip_limit !== undefined) set("wip_limit", body.wip_limit == null ? null : Number.parseInt(String(body.wip_limit), 10) || null);
        if (body.is_active !== undefined) set("is_active", !!body.is_active);
        if (body.is_terminal !== undefined) set("is_terminal", !!body.is_terminal);
        if (body.is_initial !== undefined) set("is_initial", !!body.is_initial);
        if (existing.key === "cancelled" &&
            ((body.category !== undefined && body.category !== "done") ||
             (body.is_terminal !== undefined && body.is_terminal !== true) ||
             (body.is_active !== undefined && body.is_active !== true))) {
            return res.status(400).json({ error: "Cancelled must remain active and terminal in the Done category" });
        }
        const missing = await missingProjectWorkflowCategories(req.db as unknown as WorkflowDb, projectId, stateId, {
            category: body.category,
            is_active: body.is_active,
        });
        if (missing.length) return res.status(409).json({ error: `Workflow must cover: ${missing.join(", ")}`, missing });
        if (body.is_initial === true) {
            await setOtherProjectWorkflowStatesNonInitial(req.db as unknown as WorkflowDb, projectId, stateId);
        }
        if (Object.keys(updates).length) {
            await updateProjectWorkflowState(req.db as unknown as WorkflowDb, projectId, stateId, updates);
        }
        return res.json(await findProjectWorkflowState(req.db as unknown as WorkflowDb, projectId, stateId));
    } catch (err) {
        req.log.error({ err }, "Failed to update project workflow state");
        return res.status(500).json({ error: "Failed to update workflow state" });
    }
});

router.delete("/:id/workflow-states/:stateId", async (req: Request, res: Response) => {
    const projectId = projectIdFromRequest(req);
    const stateId = stateIdFromRequest(req);
    if (!projectId || !stateId) return res.status(400).json({ error: "Invalid project or state id" });
    const access = await loadProject(req, projectId, true);
    if (access !== "ok") return failAccess(res, access);
    try {
        const existing = await findProjectWorkflowState(req.db as unknown as WorkflowDb, projectId, stateId);
        if (!existing) return res.status(404).json({ error: "Workflow state not found" });
        if (existing.key === "cancelled") return res.status(409).json({ error: "Cancelled cannot be deleted" });
        const taskCount = await countTasksInWorkflowState(req.db as unknown as WorkflowDb, stateId);
        if (taskCount > 0) return res.status(409).json({ error: "Workflow state is in use", taskCount });
        const missing = await missingProjectWorkflowCategories(req.db as unknown as WorkflowDb, projectId, stateId, { is_active: false });
        if (missing.length) return res.status(409).json({ error: `Workflow must cover: ${missing.join(", ")}`, missing });
        await deleteProjectWorkflowState(req.db as unknown as WorkflowDb, projectId, stateId);
        return res.json({ message: "Workflow state deleted" });
    } catch (err) {
        req.log.error({ err }, "Failed to delete project workflow state");
        return res.status(500).json({ error: "Failed to delete workflow state" });
    }
});

router.get("/:id/workflow-transitions", async (req: Request, res: Response) => {
    const projectId = projectIdFromRequest(req);
    if (!projectId) return res.status(400).json({ error: "Invalid project id" });
    const access = await loadProject(req, projectId, false);
    if (access !== "ok") return failAccess(res, access);
    try {
        const lifecycle = await loadLifecycleContext(req.db as any, req.userOrgId, projectId);
        return res.json({ transitions: effectiveTransitionRows(lifecycle) });
    } catch (err) {
        req.log.error({ err }, "Failed to load project transitions");
        return res.status(500).json({ error: "Failed to load workflow transitions" });
    }
});

router.put("/:id/workflow-transitions", async (req: Request, res: Response) => {
    const projectId = projectIdFromRequest(req);
    if (!projectId) return res.status(400).json({ error: "Invalid project id" });
    const access = await loadProject(req, projectId, true);
    if (access !== "ok") return failAccess(res, access);
    const transitions = req.body?.transitions;
    if (!Array.isArray(transitions)) return res.status(400).json({ error: "transitions must be an array" });
    try {
        const states = await listActiveProjectWorkflowStates(req.db as unknown as WorkflowDb, projectId);
        const byId = new Map(states.map((state) => [Number(state.id), state]));
        const edges = new Set<string>();
        for (const edge of transitions) {
            const from = byId.get(Number(edge?.from_state_id ?? edge?.from));
            const to = byId.get(Number(edge?.to_state_id ?? edge?.to));
            if (!from || !to || Number(from.id) === Number(to.id)) {
                return res.status(400).json({ error: "Transition states must be distinct active states in this project" });
            }
            if (from.key === "cancelled" || (to.key === "cancelled" && (from.category === "done" || from.is_terminal))) {
                return res.status(400).json({ error: "Cancelled is terminal and Done must be reopened before cancellation" });
            }
            edges.add(`${from.id}:${to.id}`);
        }
        const transitionEdges = [...edges].map((edge) => {
            const [from_state_id, to_state_id] = edge.split(":").map(Number);
            return { from_state_id, to_state_id };
        });
        await replaceProjectWorkflowTransitions(
            req.db as unknown as WorkflowDb,
            req.userOrgId!,
            projectId,
            transitionEdges,
        );
        return res.json({ transitions: transitionEdges });
    } catch (err) {
        req.log.error({ err }, "Failed to update project transitions");
        return res.status(500).json({ error: "Failed to update workflow transitions" });
    }
});

export = router;
