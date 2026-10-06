/** Ring timeout backstop: unanswered calls become `missed` after the shared 60s. */
export {};

jest.mock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn(), debug: jest.fn() },
}));
jest.mock("../redis", () => ({ getClient: () => null, isRedisReady: () => false }));
jest.mock("../utils/tenantManager", () => ({
    forEachTenant: jest.fn(), getTenantPool: jest.fn(), deleteTenant: jest.fn(),
}));
jest.mock("../db", () => ({ masterQuery: jest.fn() }));
jest.mock("../utils/ws", () => ({ sendToUser: jest.fn(), emitCallHistoryMessage: jest.fn() }));
jest.mock("../services/pushNotifications", () => ({
    pushNotifications: { sendCallCancellation: jest.fn().mockResolvedValue({ succeeded: 1, failed: 0 }) },
}));
jest.mock("../services/chatMediaPipeline", () => ({ processChatMediaJob: jest.fn() }));
jest.mock("../services/status", () => ({ clearActivityForRef: jest.fn().mockResolvedValue(undefined) }));

const { forEachTenant } = require("../utils/tenantManager");
const { sendToUser, emitCallHistoryMessage } = require("../utils/ws");
const { pushNotifications } = require("../services/pushNotifications");
const {
    expireStaleRingingCalls,
    STALE_RINGING_TTL_SECS,
    STALE_CALL_SWEEP_MS,
} = require("../jobs");

describe("stale ringing-call sweep", () => {
    test("uses the unified 60s ring timeout with a 5s sweep cadence", () => {
        expect(STALE_RINGING_TTL_SECS).toBe(60);
        expect(STALE_CALL_SWEEP_MS).toBe(5_000);
    });

    test("expires rings older than 60s as missed with reason no_answer", async () => {
        const db = {
            query: jest.fn(async (sql: string, _params?: unknown[]) => {
                if (sql.includes("SET status = 'missed'")) {
                    return { rows: [{ id: 700, conversation_id: 10, caller_id: 1, call_type: "voice" }] };
                }
                if (sql.startsWith("SELECT user_id FROM conversation_participants")) {
                    return { rows: [{ user_id: 1 }, { user_id: 2 }] };
                }
                return { rows: [] };
            }),
        };
        forEachTenant.mockImplementation(async (fn: any) => fn(db, { id: 3 }));

        await expect(expireStaleRingingCalls()).resolves.toBe(1);

        const expire = db.query.mock.calls.find(([sql]: any[]) => sql.includes("SET status = 'missed'"))!;
        expect(expire[1]).toEqual(["60"]);
        for (const userId of [1, 2]) {
            expect(sendToUser).toHaveBeenCalledWith(3, userId, "call_ended", {
                callId: 700,
                conversationId: 10,
                reason: "no_answer",
            });
        }
        // Only the callee had an incoming ring/push to dismiss.
        expect(pushNotifications.sendCallCancellation).toHaveBeenCalledTimes(1);
        expect(pushNotifications.sendCallCancellation).toHaveBeenCalledWith(
            expect.anything(), 2, 3, { callId: 700, conversationId: 10, reason: "cancelled" },
        );
        expect(emitCallHistoryMessage).toHaveBeenCalledWith(db, 3, 10, 1, "voice", "missed", null);
    });
});
