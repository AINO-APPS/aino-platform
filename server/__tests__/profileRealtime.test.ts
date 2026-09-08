const sendToUser = jest.fn();
jest.mock("../realtime/fanout", () => ({ sendToUser: (...args: unknown[]) => sendToUser(...args) }));
jest.mock("../utils/logger", () => ({ logger: { warn: jest.fn() } }));

import { broadcastProfileUpdate } from "../services/profileRealtime";

describe("broadcastProfileUpdate", () => {
    beforeEach(() => sendToUser.mockClear());

    test("notifies every user sharing a conversation, including the changed user's devices", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [{ user_id: 1 }, { user_id: 2 }], rowCount: 2 });
        await broadcastProfileUpdate(query, 7, 1, "/uploads/new.png");
        expect(query).toHaveBeenCalledWith(expect.stringContaining("SELECT DISTINCT peer.user_id"), [1]);
        expect(sendToUser).toHaveBeenCalledWith(7, 1, "user_profile_updated", { userId: 1, avatar: "/uploads/new.png" });
        expect(sendToUser).toHaveBeenCalledWith(7, 2, "user_profile_updated", { userId: 1, avatar: "/uploads/new.png" });
    });

    test("broadcasts avatar removal as null", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [{ user_id: 2 }], rowCount: 1 });
        await broadcastProfileUpdate(query, 7, 1, null);
        expect(sendToUser).toHaveBeenCalledWith(7, 2, "user_profile_updated", { userId: 1, avatar: null });
    });
});