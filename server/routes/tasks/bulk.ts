// Bulk backlog actions.
//   POST /api/tasks/bulk  — body { ids, action, value }
//
// Actions: move_to_sprint, status, assign, delete. The response reports what
// changed so the client can offer one undo for the whole batch.

import express from "express";
import type { Request, Response } from "express";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");
const { logHistory } = require("./_helpers/logHistory");
const { canAccessTask } = require("./_helpers/access");
const { resolveWorkflowState } = require("./_helpers/agile");
const {
    findManyInOrg, setSprint, setWorkflowState, setAssignee, deleteTask,
} = require("../../modules/tasks/tasks.repository");

const router = express.Router();

const ACTIONS = ["move_to_sprint", "status", "assign", "delete"] as const;
type BulkAction = (typeof ACTIONS)[number];

interface BulkResult {
    id: number;
    ok: boolean;
    error?: string;
    previous?: Record<string, unknown>;
}

function parseIds(raw: unknown): number[] {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw
        .map((value) => Number.parseInt(String(value), 10))
        .filter((value) => !Number.isNaN(value)))];
}

router.post("/bulk", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const ids = parseIds(req.body?.ids);
        const action = req.body?.action as BulkAction;
        const value = req.body?.value;

        if (ids.length === 0) return res.status(400).json({ error: "No tasks selected" });
        if (!ACTIONS.includes(action)) return res.status(400).json({ error: "Unknown bulk action" });

        const tasks = await findManyInOrg(req.db!, ids, req.userOrgId);

        const results: BulkResult[] = [];
        for (const task of tasks) {
            if (!await canAccessTask(task, req.userId, req.userOrgId, req.db, req.userRole)) {
                results.push({ id: task.id, ok: false, error: "Not found" });
                continue;
            }

            try {
                if (action === "move_to_sprint") {
                    const sprintId = value === null || value === "" ? null : Number.parseInt(String(value), 10);
                    await setSprint(req.db!, task.id, sprintId);
                    await logHistory(task.id, req.userId, "updated", "sprint", task.sprint_id, sprintId, null, req.db);
                    results.push({ id: task.id, ok: true, previous: { sprint_id: task.sprint_id } });
                } else if (action === "status") {
                    const target = await resolveWorkflowState(value, req.userOrgId, req.db);
                    if (!target) {
                        results.push({ id: task.id, ok: false, error: "Invalid status" });
                        continue;
                    }
                    await setWorkflowState(req.db!, task.id, target.id);
                    await logHistory(task.id, req.userId, "status_change", "workflow_state", task.workflow_state_id, target.id, null, req.db);
                    results.push({
                        id: task.id,
                        ok: true,
                        previous: { workflow_state_id: task.workflow_state_id },
                    });
                } else if (action === "assign") {
                    const assignee = value === null || value === "" ? null : Number.parseInt(String(value), 10);
                    await setAssignee(req.db!, task.id, assignee);
                    await logHistory(task.id, req.userId, "updated", "assigned_to", task.assigned_to, assignee, null, req.db);
                    results.push({ id: task.id, ok: true, previous: { assigned_to: task.assigned_to } });
                } else {
                    if (task.user_id !== req.userId) {
                        results.push({ id: task.id, ok: false, error: "Only the creator can delete a task" });
                        continue;
                    }
                    await logHistory(task.id, req.userId, "deleted", null, task.title, null, null, req.db);
                    await deleteTask(req.db!, task.id);
                    results.push({ id: task.id, ok: true, previous: { deleted: true } });
                }
            } catch (err) {
                results.push({ id: task.id, ok: false, error: (err as Error).message });
            }
        }

        const changed = results.filter((result) => result.ok);
        res.json({
            action,
            requested: ids.length,
            changed: changed.length,
            failed: results.length - changed.length,
            results,
        });
    } catch (err) {
        req.log.error({ err }, "Error applying bulk action:");
        res.status(500).json({ error: "Failed to apply bulk action" });
    }
});

export = router;
