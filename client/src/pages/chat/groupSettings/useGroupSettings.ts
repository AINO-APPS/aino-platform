import { useCallback, useEffect, useMemo, useState } from "react";
import {
    getMembers,
    getGroupInviteLink,
    updateGroupInviteLink,
    resetGroupInviteLink,
    getGroupJoinRequests,
    resolveGroupJoinRequest,
    updateGroup,
    uploadGroupAvatar,
    removeGroupAvatar,
    setGroupRole,
    transferGroupOwner,
    leaveGroup,
    type GroupInviteLink,
} from "../../../api/chat";
import { REALTIME_EVENT } from "../../../hooks/useWebSocket";
import { groupPermissions, sortMembers, type GroupMember, type GroupPolicy } from "./groupPermissions";

export interface JoinRequest {
    id: number | string;
    username?: string;
    full_name?: string;
    avatar?: string | null;
    created_at?: string;
}

function errorText(err: unknown, fallback: string): string {
    const e = err as { response?: { data?: { error?: string } } };
    return e?.response?.data?.error || fallback;
}

/** Data + mutations for the group settings pages (Android `GroupSettingsViewModel`). */
export function useGroupSettings(conv: any, currentUserId: number | string | undefined, onChanged: () => void) {
    const convId = conv.id;
    const [members, setMembers] = useState<GroupMember[]>([]);
    const [membersLoading, setMembersLoading] = useState(true);
    const [link, setLink] = useState<GroupInviteLink | null>(null);
    const [requests, setRequests] = useState<JoinRequest[]>([]);
    const [busy, setBusy] = useState(false);
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [error, setError] = useState("");
    const [toast, setToast] = useState("");
    // Optimistic overrides so the page reflects edits before the list refetch lands.
    const [local, setLocal] = useState<Record<string, unknown>>({});
    const group = useMemo(() => ({ ...conv, ...local }), [conv, local]);
    const perms = useMemo(() => groupPermissions(group, members, currentUserId), [group, members, currentUserId]);

    const flash = useCallback((msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(""), 2200);
    }, []);

    const loadMembers = useCallback(async () => {
        setMembersLoading(true);
        try {
            const { data } = await getMembers(convId);
            setMembers(sortMembers(data as GroupMember[]));
        } catch {
            /* keep the previous list */
        } finally {
            setMembersLoading(false);
        }
    }, [convId]);

    const loadLink = useCallback(async () => {
        try {
            const { data } = await getGroupInviteLink(convId);
            setLink(data);
        } catch {
            setLink(null);
        }
    }, [convId]);

    const loadRequests = useCallback(async () => {
        try {
            const { data } = await getGroupJoinRequests(convId);
            setRequests(data as JoinRequest[]);
        } catch {
            setRequests([]);
        }
    }, [convId]);

    useEffect(() => {
        void loadMembers();
    }, [loadMembers]);

    useEffect(() => {
        if (perms.canManageLink) void loadLink();
    }, [perms.canManageLink, loadLink]);

    // Live updates: pending join requests (admins) and member/role changes (everyone).
    useEffect(() => {
        const onEvent = (e: Event) => {
            const detail = (e as CustomEvent).detail as { type?: string; data?: { conversationId?: number | string } } | undefined;
            if (
                perms.canManageLink &&
                detail?.type === "chat_group_join_request" &&
                String(detail.data?.conversationId) === String(convId)
            ) {
                void loadLink();
                void loadRequests();
            }
            if (
                (detail?.type === "chat_group_role_changed" || detail?.type === "chat_group_added" || detail?.type === "chat_group_removed") &&
                String(detail.data?.conversationId) === String(convId)
            ) {
                void loadMembers();
            }
        };
        window.addEventListener(REALTIME_EVENT, onEvent);
        return () => window.removeEventListener(REALTIME_EVENT, onEvent);
    }, [perms.canManageLink, convId, loadLink, loadRequests, loadMembers]);

    const run = useCallback(
        async (fn: () => Promise<unknown>, fallback: string, ok?: string) => {
            setBusy(true);
            setError("");
            try {
                await fn();
                if (ok) flash(ok);
                onChanged();
                return true;
            } catch (err) {
                setError(errorText(err, fallback));
                return false;
            } finally {
                setBusy(false);
            }
        },
        [flash, onChanged],
    );

    return {
        group,
        perms,
        members,
        membersLoading,
        link,
        requests,
        busy,
        avatarUploading,
        error,
        toast,
        setError,
        loadRequests,
        saveInfo: (name: string, description: string) =>
            run(
                async () => {
                    await updateGroup(convId, { name: name.trim(), description: description.trim() || null });
                    setLocal((l) => ({ ...l, group_name: name.trim(), group_description: description.trim() || null }));
                },
                "Couldn't save group info",
                "Group info saved",
            ),
        uploadAvatar: async (file: File) => {
            setAvatarUploading(true);
            setError("");
            try {
                const { data } = await uploadGroupAvatar(convId, file);
                setLocal((l) => ({ ...l, group_avatar: data.avatar }));
                onChanged();
            } catch (err) {
                setError(errorText(err, "Couldn't update group photo"));
            } finally {
                setAvatarUploading(false);
            }
        },
        removeAvatar: () =>
            run(
                async () => {
                    await removeGroupAvatar(convId);
                    setLocal((l) => ({ ...l, group_avatar: null }));
                },
                "Couldn't remove group photo",
            ),
        addMembers: (ids: Array<number | string>) =>
            run(
                async () => {
                    await updateGroup(convId, { addUserIds: ids });
                    await loadMembers();
                },
                "Couldn't add members",
                ids.length === 1 ? "Member added" : `${ids.length} members added`,
            ),
        removeMember: (m: GroupMember) =>
            run(
                async () => {
                    await updateGroup(convId, { removeUserIds: [m.id] });
                    setMembers((list) => list.filter((x) => x.id !== m.id));
                },
                "Couldn't remove member",
                "Removed from group",
            ),
        setAdmin: (m: GroupMember, admin: boolean) =>
            run(
                async () => {
                    await setGroupRole(convId, m.id, admin ? "admin" : "member");
                    setMembers((list) => sortMembers(list.map((x) => (x.id === m.id ? { ...x, role: admin ? "admin" : "member" } : x))));
                },
                "Couldn't change role",
                admin ? "Now a group admin" : "No longer an admin",
            ),
        makeOwner: (m: GroupMember) =>
            run(
                async () => {
                    await transferGroupOwner(convId, m.id);
                    await loadMembers();
                    setLocal((l) => ({ ...l, my_role: "admin" }));
                },
                "Couldn't transfer ownership",
                "Ownership transferred",
            ),
        setPolicies: (changes: { postPolicy?: GroupPolicy; addPolicy?: GroupPolicy }) =>
            run(
                async () => {
                    await updateGroup(convId, changes);
                    setLocal((l) => ({
                        ...l,
                        ...(changes.postPolicy ? { post_policy: changes.postPolicy } : {}),
                        ...(changes.addPolicy ? { add_policy: changes.addPolicy } : {}),
                    }));
                },
                "Couldn't update permissions",
            ),
        updateLink: (changes: { enabled?: boolean; requiresApproval?: boolean }) =>
            run(async () => setLink((await updateGroupInviteLink(convId, changes)).data), "Couldn't update group link"),
        resetLink: () =>
            run(async () => setLink((await resetGroupInviteLink(convId)).data), "Couldn't reset group link", "Group link reset"),
        resolveRequest: (r: JoinRequest, approve: boolean) =>
            run(
                async () => {
                    await resolveGroupJoinRequest(convId, r.id, approve);
                    setRequests((list) => list.filter((x) => x.id !== r.id));
                    setLink((l) => (l ? { ...l, pendingRequests: Math.max(0, l.pendingRequests - 1) } : l));
                    if (approve) await loadMembers();
                },
                approve ? "Couldn't approve request" : "Couldn't deny request",
                approve ? "Request approved" : "Request denied",
            ),
        leave: () => run(() => leaveGroup(convId), "Couldn't leave group"),
        flash,
    };
}

export type GroupSettingsState = ReturnType<typeof useGroupSettings>;
