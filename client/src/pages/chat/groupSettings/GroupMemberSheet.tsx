import { useState } from "react";
import { createPortal } from "react-dom";
import { Crown, MessageCircle, ShieldCheck, ShieldOff, UserMinus } from "lucide-react";
import { ChatAvatar } from "../../../components/chat";
import SignalDialog from "../../../components/chat/signal/SignalDialog";
import { SettingsRow } from "./SettingsUi";
import { canRemoveMember, roleBadge, type GroupMember } from "./groupPermissions";
import type { GroupSettingsState } from "./useGroupSettings";
import s from "./GroupMemberSheet.module.css";

interface Props {
    member: GroupMember;
    gs: GroupSettingsState;
    currentUserId?: number | string;
    onMessage: (m: GroupMember) => void;
    onClose: () => void;
}

/** Android `GroupMemberSheet`: profile header, Message, admin/owner role changes, remove. */
export default function GroupMemberSheet({ member, gs, currentUserId, onMessage, onClose }: Props) {
    const { perms } = gs;
    const [confirm, setConfirm] = useState<"owner" | "remove" | null>(null);
    const isSelf = String(member.id) === String(currentUserId);
    const name = member.full_name || member.username || "Member";
    const badge = roleBadge(member.role);
    const done = (fn: () => Promise<unknown>) => async () => {
        setConfirm(null);
        await fn();
        onClose();
    };

    return createPortal(
        <div className={s.scrim} onClick={onClose}>
            <div className={s.sheet} role="dialog" aria-label={name} onClick={(e) => e.stopPropagation()}>
                <div className={s.handle} />
                <div className={s.head}>
                    <ChatAvatar name={name} avatar={member.avatar} size="xl" />
                    <div className={s.name}>{isSelf ? `${name} (You)` : name}</div>
                    {member.username && <div className={s.sub}>@{member.username}</div>}
                    {badge && <div className={s.badge}>{badge}</div>}
                </div>
                {!isSelf && (
                    <SettingsRow
                        icon={<MessageCircle size={22} />}
                        label="Message"
                        onClick={() => {
                            onClose();
                            onMessage(member);
                        }}
                    />
                )}
                {!isSelf && perms.canChangeRoles && member.role !== "owner" && (
                    member.role === "admin" ? (
                        <SettingsRow icon={<ShieldOff size={22} />} label="Remove as admin" onClick={done(() => gs.setAdmin(member, false))} />
                    ) : (
                        <SettingsRow icon={<ShieldCheck size={22} />} label="Make group admin" onClick={done(() => gs.setAdmin(member, true))} />
                    )
                )}
                {!isSelf && perms.canTransferOwnership && member.role !== "owner" && (
                    <SettingsRow icon={<Crown size={22} />} label="Make group owner" onClick={() => setConfirm("owner")} />
                )}
                {canRemoveMember(perms, member, currentUserId) && (
                    <SettingsRow icon={<UserMinus size={22} />} label="Remove from group" danger onClick={() => setConfirm("remove")} />
                )}
                <div style={{ height: 12 }} />
            </div>
            {confirm === "owner" && (
                <SignalDialog
                    title={`Make ${name} the group owner?`}
                    message="You'll become an admin. Only the owner can change roles and group policies."
                    onDismiss={() => setConfirm(null)}
                    actions={[
                        { label: "Cancel", onClick: () => setConfirm(null) },
                        { label: "Make owner", onClick: done(() => gs.makeOwner(member)) },
                    ]}
                />
            )}
            {confirm === "remove" && (
                <SignalDialog
                    title={`Remove ${name}?`}
                    message="They will no longer be able to send or receive messages in this group."
                    onDismiss={() => setConfirm(null)}
                    actions={[
                        { label: "Cancel", onClick: () => setConfirm(null) },
                        { label: "Remove", danger: true, onClick: done(() => gs.removeMember(member)) },
                    ]}
                />
            )}
        </div>,
        document.body,
    );
}
