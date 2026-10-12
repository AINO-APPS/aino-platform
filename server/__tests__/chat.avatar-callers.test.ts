export {};

const mockQuery = jest.fn();
const mockLog = { warn: jest.fn(), info: jest.fn(), error: jest.fn() };
jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = 1; req.tenantId = 2; req.roleLevel = 5;
    req.db = { query: mockQuery }; req.log = mockLog; next();
});
jest.mock("../middleware/rbac", () => ({ loadUserContext: (_req: any, _res: any, next: any) => next() }));
jest.mock("../utils/groupPerms", () => ({
    canDo: jest.fn(() => true),
    loadGroupContext: jest.fn().mockResolvedValue({ role: "owner", postPolicy: "all", addPolicy: "all", orgRoleLevel: 5 }),
}));
jest.mock("../utils/ws", () => ({ sendToUser: jest.fn(), emitCallHistoryMessage: jest.fn() }));
jest.mock("../utils/logger", () => ({
    logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn(), child: () => mockLog },
}));
jest.mock("../modules/chat/chat.avatar.repository", () => ({ getGroupPushAvatarMetadata: jest.fn() }));
jest.mock("../services/pushNotifications", () => ({
    pushNotifications: { sendMessageNotification: jest.fn().mockResolvedValue({ succeeded: 1, failed: 0 }) },
}));
jest.mock("../modules/chat/chat.shared", () => ({
    service: require("../modules/chat/chat.service").createChatService(),
    verifyParticipant: jest.fn().mockResolvedValue(true),
    verifyReplyTarget: jest.fn().mockResolvedValue(true),
    chatUpload: { single: () => (_req: any, _res: any, next: any) => next() },
}));
jest.mock("../jobs", () => ({ enqueueChatMediaPipelineJob: jest.fn() }));
jest.mock("../services/chatMediaPipeline", () => ({ broadcastMediaJobUpdate: jest.fn(), processChatMediaJob: jest.fn() }));

const request = require("supertest");
const express = require("express");
const router = require("../modules/chat/chat.message-send.routes").default;
const { chatMessage } = require("../utils/wsHandlers/chatMessage");
const { getGroupPushAvatarMetadata } = require("../modules/chat/chat.avatar.repository");
const { pushNotifications } = require("../services/pushNotifications");
const metadata = { groupAvatar: "/uploads/g.png", groupMemberPreviews: [{ name: "A", avatar: null }, { name: "B", avatar: null }] };
const app = express();
app.use(express.json());
app.use(router);

beforeEach(() => {
    jest.clearAllMocks();
    getGroupPushAvatarMetadata.mockResolvedValue(metadata);
    mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes("is_muted = TRUE")) return { rows: [], rowCount: 0 };
        if (sql.includes("SELECT user_id FROM conversation_participants")) return { rows: [{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }], rowCount: 3 };
        if (sql.includes("FROM conversation_participants cp") && sql.includes("JOIN conversations c")) return { rows: [{ is_group: true, group_name: "Team" }], rowCount: 1 };
        if (sql.includes("SELECT is_group, name AS group_name")) return { rows: [{ is_group: true, group_name: "Team" }], rowCount: 1 };
        if (sql.includes("INSERT INTO messages")) return { rows: [{ id: 77, created_at: "2026-10-12T12:00:00Z", inserted: true }], rowCount: 1 };
        if (sql.includes("FROM users") && sql.includes("full_name")) return { rows: [{ full_name: "Alice", avatar: null, username: "alice" }], rowCount: 1 };
        if (sql.includes("AS unread")) return { rows: [{ unread: 5 }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
    });
});

async function send(path: "http" | "ws") {
    if (path === "http") {
        const response = await request(app).post("/conversations/10/messages").send({ content: "Hello" });
        expect(response.status).toBe(201);
    } else {
        await chatMessage({
            db: { query: mockQuery }, senderId: 1, tenantId: 2, data: { conversationId: 10, content: "Hello" },
            ws: { readyState: 1, send: jest.fn() }, sendToUser: jest.fn(),
        });
    }
    await new Promise(resolve => setImmediate(resolve));
}

test.each(["http", "ws"] as const)("%s passes one shared group metadata load to every push recipient", async path => {
    await send(path);
    expect(getGroupPushAvatarMetadata).toHaveBeenCalledTimes(1);
    expect(getGroupPushAvatarMetadata).toHaveBeenCalledWith(expect.objectContaining({ query: expect.any(Function) }), 10);
    expect(pushNotifications.sendMessageNotification).toHaveBeenCalledTimes(2);
    const data = pushNotifications.sendMessageNotification.mock.calls.map((call: any[]) => call[3]);
    expect(data[0].groupAvatarMetadata).toBe(data[1].groupAvatarMetadata);
    expect(await data[0].groupAvatarMetadata).toEqual(metadata);
    expect(data[0]).toMatchObject({ conversationId: 10, isGroup: true, groupName: "Team" });
});

test.each(["http", "ws"] as const)("%s metadata lookup failure logs but never blocks persisted message pushes", async path => {
    getGroupPushAvatarMetadata.mockRejectedValueOnce(new Error("metadata unavailable"));
    await send(path);
    expect(pushNotifications.sendMessageNotification).toHaveBeenCalledTimes(2);
    expect(await pushNotifications.sendMessageNotification.mock.calls[0][3].groupAvatarMetadata).toBeUndefined();
    const logger = path === "http" ? mockLog : require("../utils/logger").logger;
    expect(logger.warn).toHaveBeenCalledWith({ event: "push_avatar_metadata_load_failed", conversationId: 10 }, expect.any(String));
});

test.each(["http", "ws"] as const)("%s sends never push to a recipient who muted the conversation", async path => {
    const defaultQuery = mockQuery.getMockImplementation()!;
    mockQuery.mockImplementation(async (sql: string, params?: unknown[]) =>
        sql.includes("is_muted = TRUE") ? { rows: [{ user_id: 3 }], rowCount: 1 } : defaultQuery(sql, params));
    await send(path);
    expect(pushNotifications.sendMessageNotification.mock.calls.map((call: any[]) => call[1])).toEqual([2]);
});
