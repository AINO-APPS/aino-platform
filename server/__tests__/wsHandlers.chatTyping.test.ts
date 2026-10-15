export {};

const mockWarn = jest.fn();
jest.mock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: (...a: unknown[]) => mockWarn(...a), error: jest.fn(), debug: jest.fn() },
}));

const { handleChatTyping } = require("../utils/wsHandlers/chat");

const SENDER = 1;

function makeDb(prefs: Record<number, any> | Error, others = [2, 3]) {
    return {
        query: jest.fn(async (sql: string, _params?: unknown[]) => {
            if (sql.startsWith("SELECT 1 FROM conversation_participants")) return { rows: [{ "?column?": 1 }] };
            if (sql.startsWith("SELECT user_id FROM conversation_participants")) return { rows: others.map((user_id) => ({ user_id })) };
            if (sql.includes("notification_prefs")) {
                if (prefs instanceof Error) throw prefs;
                return { rows: Object.entries(prefs).map(([id, p]) => ({ id: Number(id), notification_prefs: p })) };
            }
            throw new Error(`unexpected query: ${sql}`);
        }),
    };
}

async function run(db: any) {
    const sendToUser = jest.fn();
    await handleChatTyping({ db, senderId: SENDER, tenantId: 9, data: { conversationId: 5 }, sendToUser });
    return sendToUser.mock.calls.map(([, userId]) => userId);
}

describe("handleChatTyping typing-indicator prefs", () => {
    beforeEach(() => mockWarn.mockReset());

    test("delivers to all participants when nobody disabled typing indicators", async () => {
        const db = makeDb({ 1: {}, 2: { typingIndicators: true }, 3: {} });
        expect(await run(db)).toEqual([2, 3]);
        const prefCalls = db.query.mock.calls.filter(([sql]) => sql.includes("notification_prefs"));
        expect(prefCalls).toHaveLength(1);
        expect(prefCalls[0][1]).toEqual([[1, 2, 3]]);
    });

    test("sends nothing when the sender disabled typing indicators", async () => {
        expect(await run(makeDb({ 1: { typingIndicators: false }, 2: {}, 3: {} }))).toEqual([]);
    });

    test("skips recipients who disabled typing indicators", async () => {
        expect(await run(makeDb({ 1: {}, 2: { typingIndicators: false }, 3: null }))).toEqual([3]);
    });

    test("falls back to delivering to all when the prefs lookup fails", async () => {
        expect(await run(makeDb(new Error('column "notification_prefs" does not exist')))).toEqual([2, 3]);
        expect(mockWarn).toHaveBeenCalled();
    });

    test("non-participants still cannot broadcast typing", async () => {
        const db = { query: jest.fn(async () => ({ rows: [] })) };
        expect(await run(db)).toEqual([]);
        expect(db.query).toHaveBeenCalledTimes(1);
    });
});
