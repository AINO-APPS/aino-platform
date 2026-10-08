/**
 * Group invite links, join requests, group photo and active group call.
 *
 * Invite links are tenant-scoped by construction: every query runs on the
 * caller's tenant database, and the joiner must be an active user of the
 * group's organization. A token that belongs to another tenant simply does
 * not exist in this database (404).
 */
import crypto from "node:crypto";
import type { ChatDb } from "./chat.types";
import { ChatError } from "./chat.types";
import * as repo from "./chat.group-invite.repository";

export interface InviteLinkState {
    enabled: boolean;
    token: string | null;
    requiresApproval: boolean;
    pendingRequests: number;
}

export type JoinOutcome =
    | { status: "joined"; conversationId: number; added: boolean; userName: string | null }
    | { status: "pending"; conversationId: number; created: boolean; userName: string | null };

/**
 * True only for a group photo this server uploaded for this tenant and org
 * (`/uploads/tenant_<t>/org_<o>/avatars/group_<random>.<ext>`). Anything else
 * (another tenant's key, a user avatar, a chat attachment) is never deleted
 * and never accepted as a group avatar.
 */
export function isOwnGroupAvatarUrl(url: unknown, tenantId: unknown, orgId: unknown): url is string {
    if (typeof url !== "string" || tenantId == null || orgId == null) return false;
    const prefix = `/uploads/tenant_${Number(tenantId)}/org_${Number(orgId)}/avatars/group_`;
    return url.startsWith(prefix) && /^[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(url.slice(prefix.length));
}

/** 24 random bytes, URL-safe: unguessable and short enough to share. */
export function newInviteToken(): string {
    return crypto.randomBytes(24).toString("base64url");
}

/** Tokens are opaque base64url strings; reject anything else before touching the DB. */
export function isValidInviteToken(token: unknown): token is string {
    return typeof token === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(token);
}

async function requireGroup(db: ChatDb, conversationId: number): Promise<repo.InviteGroupRow> {
    const group = await repo.getGroupById(db, conversationId);
    if (!group) throw new ChatError("Group not found", 404);
    return group;
}

async function requireLiveLink(db: ChatDb, token: unknown): Promise<repo.InviteGroupRow> {
    if (!isValidInviteToken(token)) throw new ChatError("Invite link not found", 404);
    const group = await repo.getGroupByToken(db, token);
    if (!group || !group.invite_enabled) throw new ChatError("This invite link is no longer valid", 404);
    return group;
}

export function createGroupInviteService(tokenFactory: () => string = newInviteToken) {
    return {
        async getInviteLink(db: ChatDb, conversationId: number): Promise<InviteLinkState> {
            const group = await requireGroup(db, conversationId);
            return {
                enabled: group.invite_enabled,
                token: group.invite_enabled ? group.invite_token : null,
                requiresApproval: group.invite_requires_approval,
                pendingRequests: await repo.countJoinRequests(db, conversationId),
            };
        },

        async updateInviteLink(
            db: ChatDb,
            conversationId: number,
            changes: { enabled?: unknown; requiresApproval?: unknown },
        ): Promise<InviteLinkState> {
            const group = await requireGroup(db, conversationId);
            const enabled = typeof changes.enabled === "boolean" ? changes.enabled : group.invite_enabled;
            const requiresApproval =
                typeof changes.requiresApproval === "boolean" ? changes.requiresApproval : group.invite_requires_approval;
            const token = enabled && !group.invite_token ? tokenFactory() : null;
            await repo.updateInviteSettings(db, conversationId, enabled, requiresApproval, token);
            return this.getInviteLink(db, conversationId);
        },

        async resetInviteLink(db: ChatDb, conversationId: number): Promise<InviteLinkState> {
            await requireGroup(db, conversationId);
            await repo.setInviteToken(db, conversationId, tokenFactory());
            return this.getInviteLink(db, conversationId);
        },

        async previewInvite(db: ChatDb, userId: number, token: unknown) {
            const group = await requireLiveLink(db, token);
            const [summary, role, pending] = await Promise.all([
                repo.getMemberSummary(db, group.id),
                repo.getParticipantRole(db, group.id, userId),
                repo.hasJoinRequest(db, group.id, userId),
            ]);
            return {
                conversationId: group.id,
                name: group.name,
                description: group.description,
                avatar: group.avatar,
                memberCount: summary.memberCount,
                memberAvatars: summary.memberAvatars,
                requiresApproval: group.invite_requires_approval,
                alreadyMember: role !== null,
                pending: role === null && pending,
            };
        },

        async joinByInvite(db: ChatDb, userId: number, token: unknown): Promise<JoinOutcome> {
            const group = await requireLiveLink(db, token);
            const user = await repo.getActiveUserInOrg(db, userId, group.org_id);
            if (!user) throw new ChatError("You can't join this group", 403);
            if ((await repo.getParticipantRole(db, group.id, userId)) !== null) {
                return { status: "joined", conversationId: group.id, added: false, userName: user.full_name };
            }
            if (group.invite_requires_approval) {
                const created = await repo.insertJoinRequest(db, group.id, userId);
                return { status: "pending", conversationId: group.id, created, userName: user.full_name };
            }
            const added = await repo.addParticipant(db, group.id, userId);
            return { status: "joined", conversationId: group.id, added, userName: user.full_name };
        },

        async cancelJoinRequest(db: ChatDb, userId: number, token: unknown): Promise<void> {
            const group = await requireLiveLink(db, token);
            await repo.deleteJoinRequest(db, group.id, userId);
        },

        async listJoinRequests(db: ChatDb, conversationId: number) {
            await requireGroup(db, conversationId);
            return repo.listJoinRequests(db, conversationId);
        },

        /** Approve adds the requester; deny only drops the request. */
        async resolveJoinRequest(db: ChatDb, conversationId: number, userId: number, approve: boolean) {
            const group = await requireGroup(db, conversationId);
            const existed = await repo.deleteJoinRequest(db, conversationId, userId);
            if (!existed) throw new ChatError("No pending request for this user", 404);
            if (!approve) return { added: false, userName: null as string | null };
            const user = await repo.getActiveUserInOrg(db, userId, group.org_id);
            if (!user) throw new ChatError("User is no longer active", 410);
            const added = await repo.addParticipant(db, conversationId, userId);
            return { added, userName: user.full_name };
        },

        listGroupAdminIds: (db: ChatDb, conversationId: number) => repo.listGroupAdminIds(db, conversationId),
        getUserName: (db: ChatDb, userId: number) => repo.getUserName(db, userId),
        getGroupOrgId: async (db: ChatDb, conversationId: number) => (await requireGroup(db, conversationId)).org_id,

        async replaceGroupAvatar(db: ChatDb, conversationId: number, avatar: string | null): Promise<string | null> {
            await requireGroup(db, conversationId);
            return repo.replaceGroupAvatar(db, conversationId, avatar);
        },

        async getActiveGroupCall(db: ChatDb, userId: number, conversationId: number) {
            if ((await repo.getParticipantRole(db, conversationId, userId)) === null) {
                throw new ChatError("Not a participant", 403);
            }
            const active = await repo.getActiveGroupCall(db, conversationId);
            if (!active) return null;
            const settings = (active.meeting.settings || {}) as { callType?: string };
            return {
                meetingId: active.meeting.id,
                meetingCode: active.meeting.meeting_code,
                callType: settings.callType === "video" ? "video" : "voice",
                startedBy: active.meeting.created_by,
                startedAt: active.meeting.started_at,
                participants: active.participants.map((p: { id: number; full_name: string | null; avatar: string | null }) => ({
                    id: p.id,
                    fullName: p.full_name,
                    avatar: p.avatar,
                })),
            };
        },
    };
}
