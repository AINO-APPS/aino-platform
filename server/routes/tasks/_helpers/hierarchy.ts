import type { Request, Response } from "express";
import { HierarchyRefused, hierarchyParentId, hierarchyViolation, getHierarchyTicket, getHierarchyType } from "../../../modules/tasks/tasks.hierarchy";
const { loadAccessibleTask } = require("./access");

export function sendHierarchyRefusal(res: Response, error: unknown): boolean {
    if (!(error instanceof HierarchyRefused)) return false;
    res.status(409).json({ code: error.code, error: error.message });
    return true;
}

/** Container fields on a subtask create are derived, never trusted input. */
export async function prepareHierarchyCreate(req: Request, res: Response): Promise<boolean> {
    const type = await getHierarchyType(req.db!, req.body?.work_item_type_id, req.userOrgId ?? null);
    if (!type?.is_subtask) return true;
    const parentId = hierarchyParentId(req.body?.parent_task_id);
    if (parentId == null) throw new HierarchyRefused("A subtask must have a Story, Task or Bug parent.");
    const typedParent = await getHierarchyTicket(req.db!, parentId, req.userOrgId ?? null);
    if (!typedParent) throw new HierarchyRefused("The parent must be another existing ticket in the same organization.");
    const parent = await loadAccessibleTask(req, res, parentId);
    if (!parent) return false;
    const violation = hierarchyViolation({ org_id: req.userOrgId ?? null, project_id: parent.project_id, is_subtask: true }, typedParent);
    if (violation) throw new HierarchyRefused(violation);
    req.body = { ...req.body, project_id: parent.project_id, team_id: undefined, sprint_id: parent.sprint_id };
    return true;
}
