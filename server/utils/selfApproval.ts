/**
 * Self-approval rule shared by /manager/approvals and /leaves decisions.
 * Every role's attendance and leave requests go through approval; only
 * super_admin / platform_admin may decide a request they raised themselves.
 */
const SELF_APPROVER_ROLES = new Set(["super_admin", "platform_admin"]);

export type SelfApprovalAction = "approve" | "reject" | "revoke";

export function canSelfApprove(role: string | null | undefined): boolean {
    return SELF_APPROVER_ROLES.has(String(role || ""));
}

/** The 403 message when `actorId` may not decide their own request, else null. */
export function selfApprovalError(
    requesterId: number | string | null | undefined,
    actorId: number | string | null | undefined,
    role: string | null | undefined,
    action: SelfApprovalAction,
): string | null {
    if (requesterId == null || actorId == null || Number(requesterId) !== Number(actorId)) return null;
    return canSelfApprove(role) ? null : `You cannot ${action} your own request`;
}
