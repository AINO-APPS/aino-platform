export {};

jest.mock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../services/pushNotifications", () => ({
    pushNotifications: { sendCallCancellation: jest.fn().mockResolvedValue({}) },
}));
jest.mock("../realtime/signalStore", () => ({}));
jest.mock("../services/status", () => ({}));
jest.mock("../utils/wsHandlers/shared", () => ({
    isMeetingMember: jest.fn(),
    replayMeetingSignals: jest.fn().mockResolvedValue(undefined),
    hasOpenSocket: jest.fn(),
    cancelMeetingDisconnectCleanup: jest.fn().mockResolvedValue(false),
}));

const { handleMeetingJoin } = require("../utils/wsHandlers/meetingLifecycle");
const { MESH_PARTICIPANT_CAP, meetingIsFull } = require("../realtime/meetingCapacity");

function db(joinedOthers: number, participantStatus: string | null) {
    const query = jest.fn(async (sql: string) => {
        if (sql.startsWith("SELECT * FROM meetings")) return { rows: [{ id: 7, status: "active", org_id: null, is_huddle: false }] };
        if (sql.startsWith("SELECT status FROM meeting_participants")) return { rows: participantStatus ? [{ status: participantStatus }] : [] };
        if (sql.includes("COUNT(*)::int AS cnt")) return { rows: [{ cnt: joinedOthers }] };
        throw new Error("stop after the capacity check");
    });
    return { query };
}

describe("mesh participant cap", () => {
    test("is eight people", () => {
        expect(MESH_PARTICIPANT_CAP).toBe(8);
        expect(meetingIsFull(7)).toBe(false);
        expect(meetingIsFull(8)).toBe(true);
    });

    test("a full room refuses a new member and tells only them", async () => {
        const sendToUser = jest.fn();
        const fake = db(8, "invited");
        await handleMeetingJoin({ db: fake, senderId: 3, tenantId: 5, msg: { data: { meetingId: 7 } }, ws: {}, sendToUser });
        expect(sendToUser).toHaveBeenCalledWith(5, 3, "meeting_full", { meetingId: 7, cap: 8, participantCount: 8 });
        expect(fake.query.mock.calls.some(([sql]: [string]) => sql.includes("INSERT INTO meeting_participants"))).toBe(false);
    });

    test("a room with a free seat lets the member in", async () => {
        const sendToUser = jest.fn();
        const fake = db(7, "invited");
        await expect(
            handleMeetingJoin({ db: fake, senderId: 3, tenantId: 5, msg: { data: { meetingId: 7 } }, ws: {}, sendToUser }),
        ).rejects.toThrow("stop after the capacity check");
        expect(sendToUser).not.toHaveBeenCalledWith(5, 3, "meeting_full", expect.anything());
        expect(fake.query.mock.calls.at(-1)?.[0]).toContain("INSERT INTO meeting_participants");
    });

    test("a member already in the room keeps their seat on reconnect", async () => {
        const sendToUser = jest.fn();
        const fake = db(8, "joined");
        await expect(
            handleMeetingJoin({ db: fake, senderId: 3, tenantId: 5, msg: { data: { meetingId: 7 } }, ws: {}, sendToUser }),
        ).rejects.toThrow("stop after the capacity check");
        expect(sendToUser).not.toHaveBeenCalled();
        expect(fake.query.mock.calls.some(([sql]: [string]) => sql.includes("COUNT(*)::int AS cnt"))).toBe(false);
    });
});
