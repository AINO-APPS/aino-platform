export {};

/**
 * Silent (background) pushes must pass firebase-admin's own payload validation.
 * An empty `aps.sound` failed it with messaging/invalid-payload, rejecting the
 * whole multicast: phones were never told their session ended or that a call
 * they were ringing for was over.
 */

process.env.FIREBASE_SERVICE_ACCOUNT_KEY = JSON.stringify({
    projectId: "test-project",
    clientEmail: "test@test-project.iam.gserviceaccount.com",
    privateKey: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
});

// The package `exports` hide the validator; load the file firebase-admin itself runs.
const { validateMessage } = require(require("path").join(
    require("path").dirname(require.resolve("firebase-admin/messaging")), "messaging-internal.js",
));

const sent: any[] = [];
const sendEachForMulticast = jest.fn(async (message: any) => {
    sent.push(message);
    return { responses: message.tokens.map(() => ({ success: true })), successCount: message.tokens.length, failureCount: 0 };
});

jest.mock("firebase-admin/app", () => ({
    initializeApp: jest.fn(() => ({ name: "aino" })),
    getApp: jest.fn(() => ({ name: "aino" })),
    cert: jest.fn((serviceAccount) => serviceAccount),
}));
jest.mock("firebase-admin/messaging", () => ({ getMessaging: jest.fn(() => ({ sendEachForMulticast })) }));
jest.mock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn(), debug: jest.fn(), child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) },
    logPushCallLifecycle: jest.fn(),
}));

const { pushNotifications } = require("../services/pushNotifications");

/** What sendEachForMulticast validates per token. */
function assertFcmAccepts(multicast: any) {
    const { tokens, ...rest } = multicast;
    for (const token of tokens) expect(() => validateMessage(JSON.parse(JSON.stringify({ ...rest, token })))).not.toThrow();
}

describe("silent push payloads pass firebase-admin validation", () => {
    beforeEach(() => { sent.length = 0; });

    test("session_revoked", async () => {
        await pushNotifications.sendSessionRevoked(jest.fn().mockResolvedValue({ rows: [] }), ["fcm-1"], 3);
        expect(sent).toHaveLength(1);
        expect(sent[0].apns.payload.aps).toEqual({ "content-available": 1 });
        assertFcmAccepts(sent[0]);
    });

    test("call_handled_elsewhere (ring teardown / missed call)", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [{ device_token: "fcm-1" }] });
        await pushNotifications.sendCallCancellation(query, 1, 3, { callId: 9, conversationId: 4, reason: "cancelled" });
        expect(sent).toHaveLength(1);
        expect(sent[0].data.type).toBe("call_handled_elsewhere");
        assertFcmAccepts(sent[0]);
    });

    test("incoming call, chat message and reaction stay valid", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [{ device_token: "fcm-1", platform: "android", push_version: 4, notification_prefs: {} }] });
        await pushNotifications.sendCallNotification(query, 1, 3, { callId: 9, conversationId: 4, callerId: 2, callerName: "Asha", callType: "video" });
        await pushNotifications.sendMessageNotification(query, 1, 3, { conversationId: 4, messageId: 7, senderId: 2, senderName: "Asha", messagePreview: "hi" });
        await pushNotifications.sendReactionNotification(query, 1, 3, {
            conversationId: 4, messageId: 7, messageOwnerId: 1, actorId: 2, actorName: "Asha", actorAvatar: "",
            emoji: "❤️", reactionId: 11, sentAt: Math.floor(Date.now() / 1000),
        });
        expect(sent.length).toBeGreaterThanOrEqual(3);
        sent.forEach(assertFcmAccepts);
    });
});
