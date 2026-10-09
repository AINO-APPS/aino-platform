import ChatAvatar from "./ChatAvatar";
import GroupAvatar, { type GroupAvatarMember } from "./GroupAvatar";

const SIZE_PX: Record<string, number> = { sm: 28, md: 40, lg: 48, xl: 110 };

interface ConversationLike {
    id?: number | string;
    is_group?: boolean;
    group_name?: string | null;
    name?: string | null;
    group_avatar?: string | null;
    other_avatar?: string | null;
    group_member_previews?: GroupAvatarMember[] | null;
    group_member_avatars?: string[] | null;
    [key: string]: unknown;
}

/** Collage members from the richest data available (Android `avatarMembers`). */
export function conversationAvatarMembers(
    c: ConversationLike,
    members: { full_name?: string | null; name?: string | null; avatar?: string | null }[] = [],
): GroupAvatarMember[] {
    if (members.length) return members.map((m) => ({ name: m.full_name || m.name, avatar: m.avatar }));
    if (c.group_member_previews?.length) return c.group_member_previews;
    return (c.group_member_avatars || []).map((avatar) => ({ avatar }));
}

interface Props {
    conv: ConversationLike;
    name: string;
    size?: "sm" | "md" | "lg" | "xl" | number;
    online?: boolean;
    userStatus?: string;
    members?: { full_name?: string | null; name?: string | null; avatar?: string | null }[];
}

/** One avatar for any conversation: user avatar for direct chats, GroupAvatar for groups. */
export default function ConversationAvatar({ conv, name, size = "md", online, userStatus, members }: Props) {
    if (conv.is_group) {
        const px = typeof size === "number" ? size : SIZE_PX[size] || 40;
        return (
            <GroupAvatar
                name={name}
                photo={conv.group_avatar}
                members={conversationAvatarMembers(conv, members)}
                colorKey={conv.id ?? name}
                size={px}
            />
        );
    }
    const key = typeof size === "number" ? (size >= 100 ? "xl" : size >= 48 ? "lg" : size >= 40 ? "md" : "sm") : size;
    return <ChatAvatar avatar={conv.other_avatar} name={name} size={key} online={online} userStatus={userStatus} />;
}
