import {
    withGroupAvatarMetadata, fitMessagePushData, messageDataBytes, MESSAGE_DATA_BUDGET_BYTES,
    validGroupMemberPreviews,
} from "../platform/pushNotifications/messageAvatars";
import { getMessageDeviceTokenGroups } from "../platform/pushNotifications/deviceTokens";
import { getGroupPushAvatarMetadata } from "../modules/chat/chat.avatar.repository";
import { GROUP_MEMBER_PREVIEWS_SQL, CONVERSATION_LIST_SQL } from "../modules/chat/chat.conversation-list.repository";
import { assertRoutingPayloadContract } from "../platform/pushNotifications/payloadContract";

const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
const base = {
    type: "chat_message", conversationId: "10", messageId: "2", senderId: "1", senderName: "Alice",
    dedupeKey: "msg:2", sentAt: "2026-10-12T12:00:00.000Z", isGroup: "true", groupName: "Team", title: "Team",
    body: "Message", senderAvatar: "",
};

beforeEach(() => jest.clearAllMocks());

test("metadata reuses the conversation list's photo-first stable user-id ordering once", async () => {
    const metadata = { groupAvatar: "/uploads/group.png", groupMemberPreviews: [{ name: "A", avatar: null }] };
    const query = jest.fn().mockResolvedValue({ rows: [metadata] });
    expect(await getGroupPushAvatarMetadata({ query }, 10)).toEqual(metadata);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain(GROUP_MEMBER_PREVIEWS_SQL);
    expect(CONVERSATION_LIST_SQL).toContain(GROUP_MEMBER_PREVIEWS_SQL);
    expect(GROUP_MEMBER_PREVIEWS_SQL).toContain("ORDER BY (u4.avatar IS NULL), cp4.user_id ASC LIMIT 4");
    expect(query.mock.calls[0][1]).toEqual([10]);
});

test("Android v4+ alone gets avatar capability, with safe unmigrated-column fallback", async () => {
    const rows = [
        ...[1, 2, 3, 4, 5].map(push_version => ({ device_token: `android-${push_version}`, push_version, platform: "android" })),
        { device_token: "ios", platform: "ios", push_version: 9 },
        { device_token: "web", platform: "web", push_version: 9 },
    ];
    const query = jest.fn().mockResolvedValue({ rows });
    expect(await getMessageDeviceTokenGroups(query, 1, 2, logger)).toEqual({
        legacy: ["android-1", "android-2", "android-3", "ios", "web"], avatarAware: ["android-4", "android-5"],
    });
    expect(query.mock.calls[0][1]).toEqual([1, 2]);
    query.mockRejectedValueOnce(new Error('column "push_version" does not exist'));
    expect(await getMessageDeviceTokenGroups(query, 1, 2, logger)).toEqual({
        legacy: rows.map(row => row.device_token), avatarAware: [],
    });
});

test("UTF-8 budgets include JSON escaping and omit whole URLs/whole collages, not truncated identities", () => {
    const url = "/uploads/" + "界".repeat(800) + ".png";
    const metadata = {
        groupAvatar: url, groupMemberPreviews: [{ name: "A".repeat(200), avatar: "/uploads/" + "界".repeat(450) }],
    };
    const result = withGroupAvatarMetadata(base, metadata, logger);
    expect(result.groupAvatar).toBeUndefined();
    expect(result.groupMemberPreviews).toBe(JSON.stringify(metadata.groupMemberPreviews));
    expect(messageDataBytes(result)).toBeLessThanOrEqual(MESSAGE_DATA_BUDGET_BYTES);
    expect(Object.values(result).every(value => typeof value === "string")).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ field: "groupAvatar", reason: "field_budget" }), expect.any(String));
    const large = withGroupAvatarMetadata({ ...base, senderAvatar: "a".repeat(3000) }, {
        groupAvatar: "/uploads/g.png", groupMemberPreviews: [{ name: "Alice", avatar: "a".repeat(900) }],
    }, logger);
    expect(large.groupAvatar).toBe("/uploads/g.png");
    expect(large.groupMemberPreviews).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ field: "groupMemberPreviews", reason: "payload_budget" }), expect.any(String));
    const escaped = withGroupAvatarMetadata(base, { groupAvatar: null, groupMemberPreviews: [{ name: "A", avatar: "\\".repeat(1100) }] }, logger);
    expect(escaped.groupMemberPreviews).toBeUndefined();
});

test("invalid shapes are rejected and direct messages never gain metadata", () => {
    for (const members of [null, {}, [{ name: 1, avatar: null }], [{ name: "A" }], [{ name: "A", avatar: null, leak: "x" }],
        Array.from({ length: 5 }, () => ({ name: "A", avatar: null }))]) {
        expect(validGroupMemberPreviews(members)).toBe(false);
    }
    expect(withGroupAvatarMetadata({ ...base, isGroup: "false" }, { groupAvatar: "g", groupMemberPreviews: [] }, logger))
        .toEqual({ ...base, isGroup: "false" });
    expect(() => assertRoutingPayloadContract("message", { ...base, groupMemberPreviews: '[{"name":1,"avatar":null}]' }, logger)).toThrow();
    expect(() => assertRoutingPayloadContract("message", { ...base, groupAvatar: "g", groupMemberPreviews: "[]" }, logger)).not.toThrow();
});

test("oversized base message keeps legacy key set and never truncates sender URL", () => {
    const data = { ...base, senderAvatar: "/uploads/" + "界".repeat(2000) };
    const fitted = fitMessagePushData(data, logger);
    expect(Object.keys(fitted)).toEqual(Object.keys(data));
    expect(fitted.senderAvatar).toBe("");
    expect(fitted.body).toBe("Message");
    expect(messageDataBytes(fitted)).toBeLessThanOrEqual(MESSAGE_DATA_BUDGET_BYTES);
    const escaped = fitMessagePushData({ ...base, title: "\u0001".repeat(300), senderName: "界".repeat(400),
        groupName: "\u0002".repeat(300), body: "😀".repeat(150), senderAvatar: "/uploads/x.png" }, logger);
    expect(messageDataBytes(escaped)).toBeLessThanOrEqual(MESSAGE_DATA_BUDGET_BYTES);
    expect(escaped.title.length).toBeGreaterThan(0);
    expect(escaped.senderName.length).toBeGreaterThan(0);
    expect(escaped.senderAvatar).toBe("");
});
