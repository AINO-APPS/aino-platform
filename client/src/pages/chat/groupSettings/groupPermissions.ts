export type GroupRole = "owner" | "admin" | "member";
export type GroupPolicy = "all" | "admins";

export interface GroupMember {
    id: number | string;
    username?: string;
    full_name?: string;
    avatar?: string | null;
    role?: GroupRole;
    [key: string]: unknown;
}

/**
 * Client mirror of the server's `utils/groupPerms.canDo` (and Android
 * `GroupPermissions.kt`). Only decides which controls to show; the server
 * stays authoritative and answers 403 otherwise.
 */
export interface GroupPermissions {
    role: GroupRole | null;
    postPolicy: GroupPolicy;
    addPolicy: GroupPolicy;
    isOwner: boolean;
    isAdmin: boolean;
    isMember: boolean;
    canSend: boolean;
    canEditInfo: boolean;
    canAddMembers: boolean;
    canRemoveMembers: boolean;
    canManageLink: boolean;
    canChangeRoles: boolean;
    canTransferOwnership: boolean;
    canChangePolicies: boolean;
}

export function groupPermissions(
    conv: { my_role?: string | null; post_policy?: string | null; add_policy?: string | null },
    members: GroupMember[] = [],
    currentUserId?: number | string | null,
): GroupPermissions {
    const fromMembers = members.find((m) => currentUserId != null && String(m.id) === String(currentUserId))?.role;
    const role = ((fromMembers || conv.my_role) as GroupRole | undefined) ?? null;
    const postPolicy: GroupPolicy = conv.post_policy === "admins" ? "admins" : "all";
    const addPolicy: GroupPolicy = conv.add_policy === "all" ? "all" : "admins";
    const isOwner = role === "owner";
    const isAdmin = isOwner || role === "admin";
    const isMember = role != null;
    return {
        role,
        postPolicy,
        addPolicy,
        isOwner,
        isAdmin,
        isMember,
        canSend: isMember && (postPolicy !== "admins" || isAdmin),
        canEditInfo: isAdmin,
        canAddMembers: addPolicy === "all" ? isMember : isAdmin,
        canRemoveMembers: isAdmin,
        canManageLink: isAdmin,
        canChangeRoles: isOwner,
        canTransferOwnership: isOwner,
        canChangePolicies: isOwner,
    };
}

/** An admin may not remove the owner; nobody removes themselves (that is Leave). */
export function canRemoveMember(p: GroupPermissions, target: GroupMember, currentUserId?: number | string | null) {
    return p.canRemoveMembers && String(target.id) !== String(currentUserId) && target.role !== "owner";
}

const ROLE_RANK: Record<string, number> = { owner: 0, admin: 1 };

/** Owner first, then admins, then members, each alphabetically. */
export function sortMembers(members: GroupMember[]): GroupMember[] {
    return [...members].sort(
        (a, b) =>
            (ROLE_RANK[a.role || ""] ?? 2) - (ROLE_RANK[b.role || ""] ?? 2) ||
            String(a.full_name || a.username || "").localeCompare(String(b.full_name || b.username || "")),
    );
}

export function roleBadge(role?: string | null): string | null {
    if (role === "owner") return "Group owner";
    if (role === "admin") return "Group admin";
    return null;
}

export const policyLabel = (p: GroupPolicy) => (p === "admins" ? "Only admins" : "All members");
