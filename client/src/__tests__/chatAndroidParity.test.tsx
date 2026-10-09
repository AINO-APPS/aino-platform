import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("../FeaturesContext", () => ({ useFeatures: () => ({ hasFeature: () => true }) }));

import GroupAvatar, { groupAvatarTiles, collageMembers, groupAvatarColor } from "../components/chat/GroupAvatar";
import { getConvAvatar } from "../pages/chat/chatUtils";
import ChatHeader from "../pages/chat/ChatHeader";
import { buildHeaderMenu } from "../pages/chat/chatHeaderMenu";
import { buildConversationMenu } from "../pages/chat/conversationMenu";
import { buildMessageActions } from "../components/chat/messageActions";
import { groupPermissions, canRemoveMember, sortMembers } from "../pages/chat/groupSettings/groupPermissions";
import { callLabel, formatCallDuration } from "../pages/chat/callLabels";
import { fillTargetDimensions, formatVideoTime } from "../components/chat/video/useVideoMeta";
import { DeleteMessagesDialog } from "../pages/chat/MessageSelectionBar";

const labels = (entries: any[]) => entries.filter((e) => e && !("divider" in e)).map((e) => e.label);

describe("group avatar", () => {
    test("collage layouts mirror Android", () => {
        expect(groupAvatarTiles(0)).toHaveLength(0);
        expect(groupAvatarTiles(1)).toEqual([{ x: 0, y: 0, w: 1, h: 1 }]);
        expect(groupAvatarTiles(3)[0]).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
        expect(groupAvatarTiles(9)).toHaveLength(4);
        expect(collageMembers([{ name: "A" }, { name: "B", avatar: "/b.png" }])[0].name).toBe("B");
        expect(groupAvatarColor(7)).toBe(groupAvatarColor(7));
    });

    test("renders the uploaded photo, else member tiles, else a glyph", () => {
        const { rerender, container } = render(<GroupAvatar name="Team" photo="/g.png" colorKey={1} />);
        expect(container.querySelector("img")?.getAttribute("src")).toBe("/g.png");
        rerender(<GroupAvatar name="Team" members={[{ name: "Ann Lee" }, { name: "Bo", avatar: "/bo.png" }]} colorKey={1} />);
        expect(screen.getByText("AL")).toBeInTheDocument();
        expect(container.querySelector("img")?.getAttribute("src")).toBe("/bo.png");
        rerender(<GroupAvatar name="Team" colorKey={1} />);
        expect(screen.getByLabelText("Team")).toBeInTheDocument();
    });

    test("getConvAvatar uses group_avatar for groups", () => {
        expect(getConvAvatar({ id: 1, is_group: true, group_avatar: "/g.png", other_avatar: "/x.png" })).toBe("/g.png");
        expect(getConvAvatar({ id: 2, other_avatar: "/u.png" })).toBe("/u.png");
    });
});

describe("thread header", () => {
    const group = { id: 5, is_group: true, group_name: "Design", member_count: 3 };
    const noop = () => undefined;
    const props = {
        onlineUsers: new Set(),
        onBack: noop,
        onGroupEdit: vi.fn(),
        onToggleSearch: noop,
        onTogglePinned: noop,
        onToggleSharedFiles: noop,
        onToggleStarred: noop,
        onVoiceCall: noop,
        onVideoCall: noop,
    };

    test("group settings is not an inline header button, only in the overflow menu", () => {
        render(<ChatHeader activeConv={group} {...props} />);
        expect(screen.queryByTitle("Group settings")).toBeNull();
        expect(screen.getByLabelText("Video call")).toBeInTheDocument();
        expect(screen.getByLabelText("Voice call")).toBeInTheDocument();
        fireEvent.click(screen.getByLabelText("More options"));
        fireEvent.click(screen.getByRole("menuitem", { name: "Group settings" }));
        expect(props.onGroupEdit).toHaveBeenCalled();
    });

    test("overflow order follows Android ConversationOptionsMenu", () => {
        const h = { onViewAllMedia: noop, onSearch: noop, onPinned: noop, onStarred: noop, onMute: noop, onOpenSettings: noop, onArchive: noop, onLeave: noop, onBlock: noop, onClear: noop, onDelete: noop };
        expect(labels(buildHeaderMenu(group, h))).toEqual([
            "View all media", "Search", "Pinned messages", "Saved messages", "Mute notifications", "Group settings", "Archive", "Leave group", "Clear chat", "Delete chat",
        ]);
        expect(labels(buildHeaderMenu({ id: 2, other_user_id: 9, is_muted: true }, h))).toContain("Block");
        expect(labels(buildHeaderMenu({ id: 2, other_user_id: 9, is_muted: true }, h))).toContain("Unmute notifications");
    });

    test("shows typing in the subtitle", () => {
        render(<ChatHeader activeConv={group} {...props} typing />);
        expect(screen.getByText("typing…")).toBeInTheDocument();
    });
});

describe("menus", () => {
    test("conversation menu has Android actions", () => {
        const noop = () => undefined;
        const items = labels(buildConversationMenu({ id: 1, other_user_id: 2, unread_count: 3 }, { onPin: noop, onFav: noop, onToggleRead: noop, onMute: noop, onSelect: noop, onArchive: noop, onCall: noop, onOpenSettings: noop, onBlock: noop, onDelete: noop }, true));
        expect(items).toEqual(["Pin chat", "Mark as read", "Mute notifications", "Add to favourites", "Select", "Archive", "Voice call", "Video call", "Chat settings", "Block", "Delete"]);
    });

    test("message actions include save-to-device and delete for received messages", () => {
        const noop = () => undefined;
        const items = buildMessageActions({ id: 3, content: "hi", file_url: "/f.mp4", file_name: "f.mp4" }, false, { onDelete: noop, onSelect: noop }).map((i) => i.label);
        expect(items).toEqual(["Reply", "Forward", "Copy", "Save to device", "Select", "Pin", "Save", "Delete"]);
        expect(buildMessageActions({ id: "pending_1" }, true, {})).toEqual([]);
    });
});

describe("group permissions", () => {
    test("mirrors server canDo rules", () => {
        const member = groupPermissions({ my_role: "member", post_policy: "admins", add_policy: "all" });
        expect(member.canSend).toBe(false);
        expect(member.canAddMembers).toBe(true);
        expect(member.canManageLink).toBe(false);
        const admin = groupPermissions({ my_role: "member" }, [{ id: 4, role: "admin" }], 4);
        expect(admin.isAdmin).toBe(true);
        expect(admin.canChangeRoles).toBe(false);
        expect(canRemoveMember(admin, { id: 1, role: "owner" }, 4)).toBe(false);
        expect(canRemoveMember(admin, { id: 4, role: "admin" }, 4)).toBe(false);
        expect(canRemoveMember(admin, { id: 6, role: "member" }, 4)).toBe(true);
        expect(sortMembers([{ id: 1, full_name: "Zed" }, { id: 2, full_name: "Amy", role: "owner" }])[0].id).toBe(2);
    });
});

describe("labels and media math", () => {
    test("call labels", () => {
        expect(callLabel({ call_type: "video", status: "missed", caller_id: 2 }, 1)).toMatchObject({ title: "Missed video call", missed: true });
        expect(callLabel({ call_type: "voice", status: "missed", caller_id: 1 }, 1)).toMatchObject({ title: "Outgoing voice call", duration: "No answer" });
        expect(callLabel({ status: "ended", caller_id: 1, duration: 75 }, 1).duration).toBe("1:15");
        expect(formatCallDuration(3661)).toBe("1:01:01");
    });

    test("video time + Signal media box", () => {
        expect(formatVideoTime(65)).toBe("1:05");
        expect(formatVideoTime(3725)).toBe("1:02:05");
        expect(fillTargetDimensions(0, 0)).toEqual({ width: 210, height: 210 });
        const box = fillTargetDimensions(1920, 1080);
        expect(box.width).toBeLessThanOrEqual(240);
        expect(box.height).toBeGreaterThanOrEqual(100);
    });
});

describe("delete dialog", () => {
    test("offers delete for everyone only on own messages", () => {
        const forMe = vi.fn();
        const forAll = vi.fn();
        const { rerender } = render(<DeleteMessagesDialog count={1} canDeleteForEveryone={false} onDeleteForMe={forMe} onDeleteForEveryone={forAll} onDismiss={() => undefined} />);
        expect(screen.queryByText("Delete for everyone")).toBeNull();
        fireEvent.click(screen.getByText("Delete for me"));
        expect(forMe).toHaveBeenCalled();
        rerender(<DeleteMessagesDialog count={2} canDeleteForEveryone onDeleteForMe={forMe} onDeleteForEveryone={forAll} onDismiss={() => undefined} />);
        fireEvent.click(screen.getByText("Delete for everyone"));
        expect(forAll).toHaveBeenCalled();
    });
});
