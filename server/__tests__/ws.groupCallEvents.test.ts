export {};

jest.mock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../services/pushNotifications", () => ({ pushNotifications: {} }));

const { notifyGroupCallUpdated } = require("../utils/wsHandlers/huddles");
const { handleMeetingReaction } = require("../utils/wsHandlers/meetingSignaling");

function db(handlers: Array<[string, any[]]>) {
    return {
        query: jest.fn(async (sql: string) => {
            const hit = handlers.find(([fragment]) => sql.includes(fragment));
            return { rows: hit ? hit[1] : [], rowCount: hit ? hit[1].length : 0 };
        }),
    };
}

describe("group_call_updated fan-out", () => {
    test("tells every group member the live roster of a huddle", async () => {
        const sendToUser = jest.fn();
        const fake = db([
            ["FROM meetings WHERE id", [{ id: 7, is_huddle: true, conversation_id: 10, meeting_code: "ABC-DEFG-HJK", status: "active" }]],
            ["COUNT(*)::int AS c FROM meeting_participants", [{ c: 2 }]],
            ["FROM conversation_participants", [{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }]],
        ]);
        await notifyGroupCallUpdated({ db: fake, tenantId: 5, sendToUser }, 7);
        expect(sendToUser).toHaveBeenCalledTimes(3);
        expect(sendToUser).toHaveBeenCalledWith(5, 3, "group_call_updated", {
            conversationId: 10, meetingId: 7, meetingCode: "ABC-DEFG-HJK", active: true, participantCount: 2,
        });
    });

    test("reports inactive once the last participant leaves", async () => {
        const sendToUser = jest.fn();
        const fake = db([
            ["FROM meetings WHERE id", [{ id: 7, is_huddle: true, conversation_id: 10, meeting_code: "X", status: "ended" }]],
            ["COUNT(*)::int AS c FROM meeting_participants", [{ c: 0 }]],
            ["FROM conversation_participants", [{ user_id: 1 }]],
        ]);
        await notifyGroupCallUpdated({ db: fake, tenantId: 5, sendToUser }, 7);
        expect(sendToUser.mock.calls[0][3]).toMatchObject({ active: false, participantCount: 0 });
    });

    test("ignores regular (non-huddle) meetings", async () => {
        const sendToUser = jest.fn();
        const fake = db([["FROM meetings WHERE id", [{ id: 7, is_huddle: false, conversation_id: 10 }]]]);
        await notifyGroupCallUpdated({ db: fake, tenantId: 5, sendToUser }, 7);
        expect(sendToUser).not.toHaveBeenCalled();
    });
});

describe("meeting_reaction relay", () => {
    const joined: Array<[string, any[]]> = [
        ["status = 'joined'", [{ user_id: 1 }, { user_id: 2 }]],
        ["SELECT full_name FROM users", [{ full_name: "Ana" }]],
    ];

    test("relays a joined participant's emoji to everyone in the call", async () => {
        const sendToUser = jest.fn();
        await handleMeetingReaction({ db: db(joined), senderId: 1, tenantId: 5, msg: { data: { meetingId: 7, emoji: "👏" } }, sendToUser });
        expect(sendToUser).toHaveBeenCalledTimes(2);
        expect(sendToUser).toHaveBeenCalledWith(5, 2, "meeting_reaction", { meetingId: 7, userId: 1, name: "Ana", emoji: "👏" });
    });

    test("drops reactions from people who are not in the call, and oversized payloads", async () => {
        const sendToUser = jest.fn();
        await handleMeetingReaction({ db: db(joined), senderId: 9, tenantId: 5, msg: { data: { meetingId: 7, emoji: "👏" } }, sendToUser });
        await handleMeetingReaction({ db: db(joined), senderId: 1, tenantId: 5, msg: { data: { meetingId: 7, emoji: "x".repeat(40) } }, sendToUser });
        expect(sendToUser).not.toHaveBeenCalled();
    });
});
