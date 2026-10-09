import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
    getMembers: vi.fn(),
    getGroupInviteLink: vi.fn(),
    updateGroupInviteLink: vi.fn(),
    resetGroupInviteLink: vi.fn(),
    getGroupJoinRequests: vi.fn(),
    resolveGroupJoinRequest: vi.fn(),
    updateGroup: vi.fn(),
    uploadGroupAvatar: vi.fn(),
    removeGroupAvatar: vi.fn(),
    setGroupRole: vi.fn(),
    transferGroupOwner: vi.fn(),
    leaveGroup: vi.fn(),
    searchChatUsers: vi.fn(),
}));
vi.mock("../api/chat", () => api);
vi.mock("../FeaturesContext", () => ({ useFeatures: () => ({ hasFeature: () => true }) }));

import GroupSettingsPanel from "../pages/chat/groupSettings/GroupSettingsPanel";

const members = [
    { id: 1, full_name: "Owner One", role: "owner" },
    { id: 2, full_name: "Member Two", role: "member" },
];
const noop = () => undefined;
const base = {
    onClose: noop,
    onChanged: noop,
    onLeft: noop,
    onVoiceCall: noop,
    onVideoCall: noop,
    onMute: noop,
    onSearch: noop,
    onAllMedia: noop,
    onPinned: noop,
    onStarred: noop,
    onClear: noop,
    onMessageMember: noop,
};

describe("group settings page", () => {
    beforeEach(() => {
        Object.values(api).forEach((f) => f.mockReset());
        api.getMembers.mockResolvedValue({ data: members });
        api.getGroupInviteLink.mockResolvedValue({ data: { enabled: false, token: null, requiresApproval: false, pendingRequests: 2 } });
        api.updateGroup.mockResolvedValue({ data: { ok: true } });
        api.setGroupRole.mockResolvedValue({ data: { ok: true } });
    });

    test("owner sees admin rows and can promote a member", async () => {
        render(<GroupSettingsPanel conv={{ id: 9, is_group: true, group_name: "Design", my_role: "owner" }} currentUserId={1} {...base} />);
        expect(await screen.findByText("Member Two")).toBeInTheDocument();
        expect(screen.getByText("Group · 2 members")).toBeInTheDocument();
        await waitFor(() => expect(screen.getByText("Requests & invites")).toBeInTheDocument());
        expect(screen.getByText("Permissions")).toBeInTheDocument();
        expect(screen.getByText("Add group description…")).toBeInTheDocument();

        fireEvent.click(screen.getByText("Member Two"));
        fireEvent.click(await screen.findByText("Make group admin"));
        await waitFor(() => expect(api.setGroupRole).toHaveBeenCalledWith(9, 2, "admin"));
    });

    test("member does not see admin-only rows", async () => {
        render(<GroupSettingsPanel conv={{ id: 9, is_group: true, group_name: "Design", my_role: "member" }} currentUserId={2} {...base} />);
        expect(await screen.findByText("Owner One")).toBeInTheDocument();
        expect(screen.queryByText("Permissions")).toBeNull();
        expect(screen.queryByText("Group link")).toBeNull();
        expect(api.getGroupInviteLink).not.toHaveBeenCalled();
        expect(screen.getByText("Leave group")).toBeInTheDocument();
    });

    test("owner changes the send-messages policy", async () => {
        render(<GroupSettingsPanel conv={{ id: 9, is_group: true, group_name: "Design", my_role: "owner" }} currentUserId={1} {...base} />);
        fireEvent.click(await screen.findByText("Permissions"));
        fireEvent.click(screen.getByText("Send messages"));
        fireEvent.click(screen.getByRole("button", { name: "Only admins" }));
        await waitFor(() => expect(api.updateGroup).toHaveBeenCalledWith(9, { postPolicy: "admins" }));
    });

    test("edit page saves name and description", async () => {
        render(<GroupSettingsPanel conv={{ id: 9, is_group: true, group_name: "Design", my_role: "admin" }} currentUserId={1} {...base} />);
        fireEvent.click(await screen.findByText("Add group description…"));
        fireEvent.change(screen.getByLabelText("Description"), { target: { value: "UI team" } });
        fireEvent.click(screen.getByText("Save"));
        await waitFor(() => expect(api.updateGroup).toHaveBeenCalledWith(9, { name: "Design", description: "UI team" }));
    });
});
