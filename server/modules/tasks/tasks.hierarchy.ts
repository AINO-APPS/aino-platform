import type { PlacementDb as TasksDb } from "./tasks.placementRepository";
import { acquirePlacementLifecycleLock } from "./tasks.placementRepository";
import * as repo from "./tasks.hierarchyRepository";
import { canReadProjectTask, type TaskActor } from "./tasks.policy";
import { ticketActionConflict } from "./tasks.writeGuards";
import type { Conflict } from "./tasks.workflowRules";
export const getHierarchyType = repo.findHierarchyType;
export const getHierarchyTicket = repo.findHierarchyTicket;
export const recordHierarchyHistory = repo.recordHierarchyHistory;
export const getTicketSubtasks = repo.findHierarchySubtasks;

export class HierarchyRefused extends Error {
    readonly code = "INVALID_HIERARCHY";
}

export class HierarchyCapabilityRefused extends Error {
    constructor(readonly conflict: Conflict) { super(conflict.body.error); }
}

export function assertSubtaskTypeMutation(existing: { is_subtask?: boolean }, changes: Record<string, unknown>, deleting = false) {
    if (existing.is_subtask && (deleting || changes.is_subtask === false || changes.is_active === false
        || changes.is_epic === true || changes.is_default === true)) {
        throw new HierarchyRefused("The seeded Subtask type cannot be deleted, deactivated, made default or turned into another type.");
    }

    if (!existing.is_subtask && changes.is_subtask === true) {
        throw new HierarchyRefused("Each organization has exactly one seeded Subtask type.");
    }
}

export async function assertHierarchyTypeEdit(db: TasksDb, existing: any, changes: Record<string, unknown>) {
    await acquirePlacementLifecycleLock(db, existing.org_id);
    assertSubtaskTypeMutation(existing, changes);
    if (changes.is_epic !== undefined && !!changes.is_epic !== existing.is_epic
        && await repo.hierarchyTypeIsUsed(db, existing.id)) {
        throw new HierarchyRefused("A type used by tickets cannot change hierarchy level. Change individual ticket types instead.");
    }
}

export interface HierarchyTicket {
    id?: number;
    org_id: number | null;
    project_id: number | null;
    sprint_id?: number | null;
    parent_task_id?: number | null;
    work_item_type_id?: number | null;
    is_epic?: boolean;
    is_subtask?: boolean;
    story_points?: unknown;
}

/** Custom non-epic types occupy the Story/Task/Bug level. */
export function hierarchyViolation(ticket: HierarchyTicket, parent: HierarchyTicket | null): string | null {
    if (ticket.is_epic) return parent ? "An epic cannot have a parent." : null;
    if (ticket.is_subtask) {
        if (ticket.story_points != null && ticket.story_points !== "") return "A subtask cannot carry story points.";
        if (!parent || parent.is_epic || parent.is_subtask) return "A subtask must have a Story, Task or Bug parent.";
        if (ticket.project_id == null || Number(ticket.project_id) !== Number(parent.project_id)) return "A subtask must be in its parent's project.";
        if (ticket.sprint_id !== undefined && String(ticket.sprint_id ?? "") !== String(parent.sprint_id ?? "")) return "A subtask must be in its parent's sprint.";
        return null;
    }
    return parent && !parent.is_epic ? "A Story, Task or Bug may only have an epic as its parent." : null;
}

export function hierarchyParentId(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === "") return null;
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id < 1) throw new HierarchyRefused("The parent must be an existing ticket in the same organization.");
    return id;
}

/** Call inside the write transaction, before acquiring ticket/date row locks. */
export async function assertTicketHierarchy(db: TasksDb, change: Partial<HierarchyTicket> & { org_id: number | null }, actor?: TaskActor, cascadeProject = false) {
    await acquirePlacementLifecycleLock(db, change.org_id);
    const current = change.id == null ? null : await repo.findHierarchyTicket(db, change.id, change.org_id);
    const ticket = { ...current, ...change };
    const type = ticket.work_item_type_id == null ? null : await repo.findHierarchyType(
        db, ticket.work_item_type_id, change.org_id, false);
    if (type?.is_active === false && String(current?.work_item_type_id ?? "") !== String(type.id)) {
        throw new HierarchyRefused("A newly selected ticket type must be active.");
    }
    ticket.is_epic = type?.is_epic === true;
    ticket.is_subtask = type?.is_subtask === true;
    const parentId = hierarchyParentId(ticket.parent_task_id);
    const parent = parentId == null ? null : await repo.findHierarchyTicket(db, parentId, change.org_id);
    if (parentId != null && (!parent || parentId === ticket.id)) {
        throw new HierarchyRefused("The parent must be another existing ticket in the same organization.");
    }
    if (parent && change.parent_task_id !== undefined && actor && !await canReadProjectTask(parent, actor)) {
        throw new HierarchyRefused("The parent must be an accessible ticket in the same organization.");
    }
    const violation = hierarchyViolation(ticket, parent);
    if (violation) throw new HierarchyRefused(violation);
    if (ticket.is_subtask && parent && actor && (!current || !current.is_subtask
        || Number(current.parent_task_id) !== Number(parentId))) {
        const conflict = await ticketActionConflict(db, actor, parent, "canAddSubtask");
        if (conflict) throw new HierarchyCapabilityRefused(conflict);
    }
    if (ticket.id != null) {
        for (const child of await repo.findHierarchyChildren(db, ticket.id)) {
            const childViolation = hierarchyViolation(cascadeProject && child.is_subtask
                ? { ...child, project_id: ticket.project_id } : child, ticket);
            if (childViolation) throw new HierarchyRefused(`This change would invalidate a child: ${childViolation}`);
        }
    }
    return { ticket, parent, current };
}

export async function setTicketParent(db: TasksDb, id: number, orgId: number | null, rawParentId: unknown, userId: number, actor?: TaskActor) {
    const parentId = hierarchyParentId(rawParentId);
    const { current } = await assertTicketHierarchy(db, { id, org_id: orgId, parent_task_id: parentId }, actor);
    await repo.writeHierarchyParent(db, id, parentId, current?.parent_task_id ?? null, userId);
    return parentId;
}
