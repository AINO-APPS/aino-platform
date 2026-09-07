/** Task-domain orchestration, independent of HTTP. */
import * as repository from "./tasks.repository";
import type { GitRefInput, TasksDb } from "./tasks.types";

export const getTask = repository.findTask;
export const getComments = repository.findComments;
export const getHistory = repository.findHistory;
export const getAssignableUsers = repository.findAssignableUsers;
export const getLabels = repository.findLabels;

export async function updateBlocker(db: TasksDb, id: number, userId: number, blocked: boolean, reason: string | null) {
    await repository.setBlocked(db, id, blocked, reason);
    await repository.addHistory(db, id, blocked ? "blocked" : "unblocked", "blocker", reason || (blocked ? "No reason given" : null), userId).catch(() => undefined);
    return { id, is_blocked: blocked, blocked_reason: reason };
}

export async function updateCriteria(db: TasksDb, id: number, userId: number, criteria: unknown[]) {
    await repository.setCriteria(db, id, criteria);
    await repository.addHistory(db, id, "updated", "acceptance_criteria", `${criteria.length} item(s)`, userId).catch(() => undefined);
    return { criteria };
}

export async function listGitRefs(db: TasksDb, id: number) {
    const refs = await repository.findGitRefs(db, id);
    const grouped: Record<"branches" | "pull_requests" | "commits", any[]> = { branches: [], pull_requests: [], commits: [] };
    for (const ref of refs) {
        if (ref.ref_type === "branch") grouped.branches.push(ref);
        else if (ref.ref_type === "pull_request") grouped.pull_requests.push(ref);
        else if (ref.ref_type === "commit") grouped.commits.push(ref);
    }
    return { refs, grouped };
}

export function addGitRef(db: TasksDb, id: number, input: GitRefInput) {
    const status = ["open", "merged", "closed", "draft", "committed"].includes(String(input.status))
        ? String(input.status) : input.ref_type === "commit" ? "committed" : "open";
    return repository.saveGitRef(db, id, input, status);
}

export const removeGitRef = repository.deleteGitRef;

export async function getChildren(db: TasksDb, id: number) {
    const children = await repository.findChildren(db, id);
    const points = (value: unknown) => value == null ? 0 : Number(value);
    const totalPoints = children.reduce((sum, child) => sum + points(child.story_points), 0);
    const completed = children.filter((child) => child.is_terminal);
    const donePoints = completed.reduce((sum, child) => sum + points(child.story_points), 0);
    return { children, rollup: {
        totalChildren: children.length, doneChildren: completed.length, totalPoints, donePoints,
        percentByPoints: totalPoints ? Math.round(donePoints / totalPoints * 100) : 0,
        percentByCount: children.length ? Math.round(completed.length / children.length * 100) : 0,
    } };
}

export const getParent = repository.findParent;

export async function validateAndSetParent(db: TasksDb, id: number, orgId: number | null, rawParentId: unknown) {
    let parentId: number | null = null;
    if (rawParentId !== null && rawParentId !== undefined && rawParentId !== "") {
        const candidateId = Number.parseInt(String(rawParentId), 10);
        if (Number.isNaN(candidateId) || candidateId === id) throw new Error("Invalid parent_task_id");
        const candidate = await repository.findTaskOrg(db, candidateId);
        if (!candidate || candidate.org_id !== orgId) throw new Error("Parent task not found");
        let cursor: number | null = candidate.id;
        for (let depth = 0; depth < 50 && cursor; depth++) {
            if (cursor === id) throw new Error("Would create a cycle (task is an ancestor of the candidate parent)");
            cursor = await repository.findParentId(db, cursor);
        }
        parentId = candidate.id;
    }
    await repository.setParent(db, id, parentId);
    return parentId;
}