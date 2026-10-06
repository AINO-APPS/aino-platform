export {};

/**
 * `call_ringing` (callee device → caller "Ringing…") and the shared
 * caller-cancel logic used by WS `call_cancel` and POST /api/chat/calls/cancel.
 */
jest.mock("../utils/logger", () => ({
    logger: {
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn(), debug: jest.fn(),
        child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    },
    logPushCallLifecycle: jest.fn(),
}));
jest.mock("../services/pushNotifications", () => ({
    pushNotifications: { sendCallCancellation: jest.fn().mockResolvedValue({ succeeded: 1, failed: 0 }) },
}));
jest.mock("../realtime/signalStore", () => ({ clearCallSignals: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/status", () => ({ clearActivityForRef: jest.fn().mockResolvedValue(undefined) }));

const { pushNotifications } = require("../services/pushNotifications");
const signalStore = require("../realtime/signalStore");
const statusService = require("../services/status");
const {
    acknowledgeCallRinging,
    cancelRingingCall,
    handleCallRinging,
} = require("../utils/wsHandlers/callRinging");
const { handleCallCancel } = require("../utils/wsHandlers/callTermination");
const { handleChatMessage } = require("../realtime/messageRouter");

const CALLER = 1;
const CALLEE = 2;

/** Route by SQL text so the order of independent lookups never matters. */
function makeRingingDb({
    member = true,
    call = { caller_id: CALLER, status: "ringing" } as any,
    updated = true,
} = {}) {
    return {
        query: jest.fn(async (sql: string, _params?: unknown[]) => {
            if (sql.startsWith("SELECT 1 FROM conversation_participants")) return { rows: member ? [{ x: 1 }] : [] };
            if (sql.startsWith("SELECT caller_id, status FROM call_logs")) return { rows: call ? [call] : [] };
            if (sql.includes("SET ringing_at")) return { rows: updated ? [{ id: 500 }] : [] };
            if (sql.startsWith("SELECT status FROM call_logs")) return { rows: [{ status: "answered" }] };
            return { rows: [] };
        }),
    };
}

describe("acknowledgeCallRinging", () => {
    test("forwards call_ringing to the caller (all sessions) and keeps the first ack time", async () => {
        const db = makeRingingDb();
        const sendToUser = jest.fn();

        const result = await acknowledgeCallRinging(db, 7, CALLEE, 500, 10, sendToUser);

        expect(result).toEqual({ outcome: "forwarded", status: "ringing" });
        expect(sendToUser).toHaveBeenCalledTimes(1);
        expect(sendToUser).toHaveBeenCalledWith(7, CALLER, "call_ringing", {
            callId: 500,
            conversationId: 10,
            userId: CALLEE,
        });
        const update = db.query.mock.calls.find(([sql]: any[]) => sql.includes("SET ringing_at"))!;
        expect(update[0]).toContain("COALESCE(ringing_at, NOW())");
        expect(update[0]).toContain("status = 'ringing'");
    });

    test.each([
        ["not a participant", { member: false }, { outcome: "not_participant" }],
        ["call missing", { call: null }, { outcome: "not_found" }],
        ["sender is the caller", { call: { caller_id: CALLEE, status: "ringing" } }, { outcome: "is_caller" }],
        ["call already answered", { call: { caller_id: CALLER, status: "answered" } }, { outcome: "not_ringing", status: "answered" }],
        ["lost the race to an answer", { updated: false }, { outcome: "not_ringing", status: "answered" }],
    ])("does not forward when %s", async (_label, opts, expected) => {
        const sendToUser = jest.fn();
        const result = await acknowledgeCallRinging(makeRingingDb(opts as any), 7, CALLEE, 500, 10, sendToUser);
        expect(result).toEqual(expected);
        expect(sendToUser).not.toHaveBeenCalled();
    });
});

describe("WS call_ringing", () => {
    test("is routed by the message router and deduped per (callId, sender)", async () => {
        const db = makeRingingDb();
        const sendToUser = jest.fn();
        const frame = { type: "call_ringing", data: { callId: 9101, conversationId: 10, clientMsgId: "r-1" } };

        await handleChatMessage(db, CALLEE, 7, frame, {} as any, sendToUser);
        await handleChatMessage(db, CALLEE, 7, { ...frame, data: { ...frame.data, clientMsgId: "r-2" } }, {} as any, sendToUser);

        expect(sendToUser).toHaveBeenCalledTimes(1);
        expect(sendToUser).toHaveBeenCalledWith(7, CALLER, "call_ringing", {
            callId: 9101,
            conversationId: 10,
            userId: CALLEE,
        });
    });

    test("ignores frames without positive integer ids", async () => {
        const db = makeRingingDb();
        const sendToUser = jest.fn();
        for (const data of [{}, { callId: "abc", conversationId: 10 }, { callId: 9102, conversationId: 0 }]) {
            await handleCallRinging({ db, senderId: CALLEE, tenantId: 7, msg: { data }, ws: {} as any, sendToUser });
        }
        expect(db.query).not.toHaveBeenCalled();
        expect(sendToUser).not.toHaveBeenCalled();
    });
});

describe("cancelRingingCall (shared by WS call_cancel and HTTP /calls/cancel)", () => {
    function makeCancelDb({ ringing = true, updated = true } = {}) {
        return {
            query: jest.fn(async (sql: string, _params?: unknown[]) => {
                if (sql.startsWith("SELECT id, call_type FROM call_logs")) {
                    return { rows: ringing ? [{ id: 600, call_type: "video" }] : [] };
                }
                if (sql.startsWith("UPDATE call_logs SET status = 'missed'")) return { rows: updated ? [{ id: 600 }] : [] };
                if (sql.startsWith("SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id != $2")) {
                    return { rows: [{ user_id: CALLEE }] };
                }
                if (sql.includes("INSERT INTO messages")) return { rows: [{ id: 77, created_at: "2026-10-06T00:00:00Z" }] };
                if (sql.startsWith("SELECT user_id FROM conversation_participants WHERE conversation_id = $1")) {
                    return { rows: [{ user_id: CALLER }, { user_id: CALLEE }] };
                }
                return { rows: [] };
            }),
        };
    }

    beforeEach(() => jest.clearAllMocks());

    test("marks the call missed and tears down every ring", async () => {
        const db = makeCancelDb();
        const sendToUser = jest.fn();

        await expect(cancelRingingCall(db, 7, CALLER, 10, sendToUser)).resolves.toEqual({ callId: 600 });

        expect(sendToUser).toHaveBeenCalledWith(7, CALLEE, "call_ended", { callId: 600, conversationId: 10 });
        expect(sendToUser).toHaveBeenCalledWith(7, CALLER, "call_ended", { callId: 600, conversationId: 10 });
        expect(pushNotifications.sendCallCancellation).toHaveBeenCalledWith(
            expect.anything(), CALLEE, 7, { callId: 600, conversationId: 10, reason: "cancelled" },
        );
        expect(statusService.clearActivityForRef).toHaveBeenCalledWith(expect.anything(), "in_call", 600);
        const history = sendToUser.mock.calls.filter(([, , type]: any[]) => type === "chat_message");
        expect(history).toHaveLength(2);
        expect(history[0][3].metadata).toMatchObject({ type: "call", status: "missed", callType: "video" });
        expect(signalStore.clearCallSignals).toHaveBeenCalledWith(7, 600);
    });

    test("is a no-op when the caller has nothing ringing", async () => {
        const sendToUser = jest.fn();
        await expect(cancelRingingCall(makeCancelDb({ ringing: false }), 7, CALLER, 10, sendToUser)).resolves.toBeNull();
        await expect(cancelRingingCall(makeCancelDb({ updated: false }), 7, CALLER, 10, sendToUser)).resolves.toBeNull();
        expect(sendToUser).not.toHaveBeenCalled();
        expect(pushNotifications.sendCallCancellation).not.toHaveBeenCalled();
    });

    test("WS call_cancel delegates to it and clears the socket's call activity", async () => {
        const ws: any = { _callActivityRefId: 600 };
        const sendToUser = jest.fn();

        await handleCallCancel({
            db: makeCancelDb(), senderId: CALLER, tenantId: 7,
            msg: { data: { conversationId: 10 } }, ws, sendToUser,
        });

        expect(ws._callActivityRefId).toBeNull();
        expect(sendToUser).toHaveBeenCalledWith(7, CALLEE, "call_ended", { callId: 600, conversationId: 10 });
    });
});
