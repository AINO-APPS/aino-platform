export {};

const sendEachForMulticast = jest.fn(async (message: any) => ({
    responses: message.tokens.map(() => ({ success: true })),
    successCount: message.tokens.length, failureCount: 0,
}));
jest.mock("../platform/pushNotifications/firebaseApp", () => ({
    initializePushFirebaseApp: jest.fn(() => ({ name: "aino" })),
}));
jest.mock("firebase-admin/messaging", () => ({
    getMessaging: jest.fn(() => ({ sendEachForMulticast })),
}));
jest.mock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
const { pushNotifications } = require("../services/pushNotifications");
const { assertRoutingPayloadContract } = require("../platform/pushNotifications/payloadContract");

describe("Android reaction push", () => {
    const sentAt = Math.floor(Date.now() / 1000);
    const reaction = {
        conversationId: 10, messageId: 12, messageOwnerId: 2, actorId: 1,
        actorName: "Alice", actorAvatar: "", emoji: "👍", reactionId: 91, sentAt,
    };
    beforeEach(() => jest.clearAllMocks());

    test("sends only capable Android tokens with the exact data-only schema", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [
            { device_token: "android3", platform: "android", push_version: 3 },
            { device_token: "android4", platform: "android", push_version: 4 },
            { device_token: "android2", platform: "android", push_version: 2 },
            { device_token: "android1", platform: "android", push_version: 1 },
            { device_token: "ios3", platform: "ios", push_version: 3 },
            { device_token: "web3", platform: "web", push_version: 3 },
        ] });
        expect(await pushNotifications.sendReactionNotification(query, 2, 7, reaction)).toEqual({
            succeeded: 2, failed: 0,
        });
        expect(query).toHaveBeenCalledWith(expect.stringContaining("platform = 'android' AND push_version >= 3"), [2, 7]);
        const sent = sendEachForMulticast.mock.calls[0][0];
        expect(sent.tokens).toEqual(["android3", "android4"]);
        expect(sent).not.toHaveProperty("notification");
        expect(sent.android).not.toHaveProperty("notification");
        expect(sent.apns).toBeUndefined();
        expect(sent.webpush).not.toHaveProperty("notification");
        expect(sent.android).toMatchObject({ priority: "high" });
        expect(sent.android.ttl).toBeGreaterThan(0);
        expect(sent.android.ttl).toBeLessThanOrEqual(86400000);
        expect(sent.data).toEqual({
            type: "chat_reaction", title: "Alice", body: "Alice reacted 👍 to your message",
            conversationId: "10", messageId: "12", messageOwnerId: "2", actorId: "1",
            actorName: "Alice", actorAvatar: "", emoji: "👍", reactionId: "91", action: "added",
            dedupeKey: "reaction:91", tenantId: "7", sentAt: new Date(sentAt * 1000).toISOString(), expiresAt: String(sentAt + 86400),
        });
    });

    test.each([
        ["self", 1, { ...reaction, messageOwnerId: 1 }],
        ["wrong owner", 3, reaction],
        ["expired", 2, { ...reaction, sentAt: sentAt - 86401 }],
    ])("skips %s", async (_name, userId, data) => {
        const query = jest.fn();
        expect(await pushNotifications.sendReactionNotification(query, userId, 7, data)).toEqual({ succeeded: 0, failed: 0 });
        expect(query).not.toHaveBeenCalled();
        expect(sendEachForMulticast).not.toHaveBeenCalled();
    });

    test("never falls back to legacy tokens when capability lookup fails", async () => {
        const query = jest.fn().mockRejectedValue(new Error("column push_version does not exist"));
        expect(await pushNotifications.sendReactionNotification(query, 2, 7, reaction)).toEqual({ succeeded: 0, failed: 0 });
        expect(query).toHaveBeenCalledTimes(1);
        expect(sendEachForMulticast).not.toHaveBeenCalled();
    });

    test("transport failure is counted without throwing", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [{ device_token: "a", platform: "android", push_version: 3 }] });
        sendEachForMulticast.mockRejectedValueOnce(new Error("FCM unavailable"));
        expect(await pushNotifications.sendReactionNotification(query, 2, 7, reaction)).toEqual({ succeeded: 0, failed: 1 });
    });

    test("validates identity, action, ISO sentAt, epoch expiresAt and unknown keys", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [{ device_token: "a", platform: "android", push_version: 3 }] });
        await pushNotifications.sendReactionNotification(query, 2, 7, reaction);
        const data = sendEachForMulticast.mock.calls[0][0].data;
        const logger = { error: jest.fn() };
        for (const mutation of [
            { reactionId: "0" }, { action: "removed" }, { sentAt: String(sentAt) },
            { dedupeKey: "reaction:92" }, { actorId: "2" }, { expiresAt: String(sentAt) }, { link: "/chat" },
        ]) {
            expect(() => assertRoutingPayloadContract("reaction", { ...data, ...mutation }, logger)).toThrow();
        }
    });
});
