/**
 * Approval-flow notification helpers shared by leaves, manager approvals and
 * attendance. Each helper persists the in-app notification (which also fans
 * out over WS + FCM via notifyUser) and emits the domain realtime event the
 * clients refetch on. Call them AFTER the owning transaction has committed.
 */
const { notifyUser, sendToUser } = require("./ws");
import { ATTENDANCE_LINK, LEAVES_LINK, MANUAL_ENTRY_LINK, approvalLink } from "./notificationLinks";
import { getTenantRolesMap, levelForRole } from "../middleware/rbac";

interface DbLike {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

export async function requesterDisplayName(db: DbLike, userId: number): Promise<string> {
    const row = (await db.query("SELECT full_name FROM users WHERE id = $1", [userId])).rows[0];
    return row?.full_name || "A team member";
}

/** Tell an approver a new request awaits them (notification + approval_update). */
export async function notifyApproverOfRequest(
    db: DbLike,
    tenantId: number | null | undefined,
    opts: {
        approverId: number;
        requesterId: number;
        type: string;
        approvalId?: number | null;
        title: string;
        body: (requesterName: string) => string;
    },
): Promise<void> {
    const name = await requesterDisplayName(db, opts.requesterId);
    await notifyUser(db, tenantId, opts.approverId, "approval", opts.title, opts.body(name), {
        actorId: opts.requesterId,
        link: approvalLink(opts.approvalId),
    });
    sendToUser(tenantId, opts.approverId, "approval_update", {
        ...(opts.approvalId ? { id: opts.approvalId } : {}),
        type: opts.type,
        status: "pending",
    });
}

/**
 * Tell a requester their request was decided. Leaves emit `leave_update`
 * ({ id: leaveId, status }); other request types emit `approval_update`.
 */
export async function notifyRequesterOfDecision(
    db: DbLike,
    tenantId: number | null | undefined,
    opts: {
        requesterId: number;
        actorId: number | null | undefined;
        kind: "leave" | "manual_entry" | "overtime" | "work_mode_change";
        status: string;
        title: string;
        body: string;
        leaveId?: number | null;
        approvalId?: number | null;
    },
): Promise<void> {
    const isLeave = opts.kind === "leave";
    await notifyUser(db, tenantId, opts.requesterId, isLeave ? "leave" : "approval", opts.title, opts.body, {
        actorId: opts.actorId,
        link: isLeave ? LEAVES_LINK : opts.kind === "work_mode_change" ? ATTENDANCE_LINK : MANUAL_ENTRY_LINK,
    });
    if (isLeave) {
        sendToUser(tenantId, opts.requesterId, "leave_update", {
            ...(opts.leaveId ? { id: opts.leaveId } : {}),
            status: opts.status,
        });
    } else {
        sendToUser(tenantId, opts.requesterId, "approval_update", {
            ...(opts.approvalId ? { id: opts.approvalId } : {}),
            type: opts.kind,
            status: opts.status,
        });
    }
}

/** Sync the acting approver's other devices after a decision. */
export function emitApproverDecision(
    tenantId: number | null | undefined,
    approverId: number | null | undefined,
    type: string | undefined,
    status: string,
    approvalId?: number | null,
): void {
    if (!approverId) return;
    sendToUser(tenantId, approverId, "approval_update", {
        ...(approvalId ? { id: approvalId } : {}),
        type,
        status,
    });
}

export interface ApprovalDecision {
    approvalId?: number | null;
    requesterId: number;
    originalApproverId?: number | null;
    type?: string;
}

/** Emit after commit; actor delivery does not wait for recipient lookups or notifications. */
export async function emitApprovalDecisions(
    db: DbLike,
    tenantId: number | null | undefined,
    actorId: number,
    decisions: readonly ApprovalDecision[],
    status: "approved" | "rejected",
): Promise<void> {
    if (decisions.length === 0) return;
    if (decisions.length === 1) {
        emitApproverDecision(tenantId, actorId, decisions[0].type, status, decisions[0].approvalId);
    } else {
        emitApproverDecision(tenantId, actorId, "bulk", status);
    }

    const requesters = (await db.query(
        "SELECT id, org_id, manager_id FROM users WHERE id = ANY($1)",
        [[...new Set(decisions.map((d) => d.requesterId))]],
    )).rows as { id: number; org_id: number | null; manager_id: number | null }[];
    const orgIds = [...new Set(requesters.map((u) => u.org_id).filter((id): id is number => id != null))];
    if (orgIds.length === 0) return;
    const roleMaps = new Map(await Promise.all(orgIds.map(async (orgId) =>
        [orgId, await getTenantRolesMap(db, orgId, tenantId)] as const,
    )));
    const adminRoles = new Set(["hr_admin", "super_admin", "platform_admin"]);
    for (const map of roleMaps.values()) {
        for (const role of Object.keys(map)) if (levelForRole(role, map) >= 4) adminRoles.add(role);
    }
    const assignedIds = [...new Set([
        ...decisions.map((d) => d.originalApproverId),
        ...requesters.map((u) => u.manager_id),
    ].filter((id): id is number => id != null))];
    const viewers = (await db.query(
        `SELECT id, role, org_id FROM users
         WHERE org_id = ANY($1) AND is_active = TRUE
           AND (id = ANY($2) OR role = ANY($3::text[]))`,
        [orgIds, assignedIds, [...adminRoles]],
    )).rows as { id: number; role: string; org_id: number }[];

    for (const decision of decisions) {
        const requester = requesters.find((u) => u.id === decision.requesterId);
        if (!requester?.org_id) continue;
        const recipients = new Set<number>();
        for (const viewer of viewers) {
            if (viewer.org_id !== requester.org_id || viewer.id === actorId) continue;
            const level = levelForRole(viewer.role, roleMaps.get(viewer.org_id));
            if (viewer.id === requester.id && viewer.role !== "super_admin") continue;
            if (level >= 4 || (level >= 2 &&
                (viewer.id === decision.originalApproverId || viewer.id === requester.manager_id))) {
                recipients.add(viewer.id);
            }
        }
        for (const id of recipients) {
            emitApproverDecision(tenantId, id, decision.type, status, decision.approvalId);
        }
    }
}
