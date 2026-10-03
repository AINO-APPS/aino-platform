/**
 * Approval-flow notification helpers shared by leaves, manager approvals and
 * attendance. Each helper persists the in-app notification (which also fans
 * out over WS + FCM via notifyUser) and emits the domain realtime event the
 * clients refetch on. Call them AFTER the owning transaction has committed.
 */
const { notifyUser, sendToUser } = require("./ws");
import { LEAVES_LINK, MANUAL_ENTRY_LINK, approvalLink } from "./notificationLinks";

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
        kind: "leave" | "manual_entry" | "overtime";
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
        link: isLeave ? LEAVES_LINK : MANUAL_ENTRY_LINK,
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
