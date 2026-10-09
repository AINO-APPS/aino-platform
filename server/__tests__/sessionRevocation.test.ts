export {};

const publish = jest.fn();
const sendSessionRevoked = jest.fn().mockResolvedValue({ succeeded: 1, failed: 0 });
jest.mock("../redis", () => ({ publish: (...args: unknown[]) => publish(...args) }));
jest.mock("../services/pushNotifications", () => ({
    pushNotifications: { sendSessionRevoked: (...args: unknown[]) => sendSessionRevoked(...args) },
}));

const { closeSessionSockets, closeSessionSocketsLocal, closeOtherSessionSockets, REVOKE_SESSIONS_KIND } = require("../realtime/sessionRevocation");
const { signOutRevokedSessions, SIGNED_IN_ELSEWHERE } = require("../services/sessionSignOut");
const { INSTANCE_ID } = require("../realtime/fanout");
const { clients, clientKey } = require("../realtime/registry");

function socket(sessionId: string) {
    return { readyState: 1, _sessionId: sessionId, close: jest.fn(), send: jest.fn() };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("session revocation", () => {
    beforeEach(() => {
        clients.clear();
        publish.mockClear();
        sendSessionRevoked.mockClear();
    });

    test("closes only the revoked sessions' sockets with 4001 and tells other instances", () => {
        const oldPhone = socket("old");
        const browser = socket("web");
        clients.set(clientKey(3, 9), new Set([oldPhone, browser]));

        closeSessionSockets(3, 9, ["old"], SIGNED_IN_ELSEWHERE);

        expect(oldPhone.close).toHaveBeenCalledWith(4001, SIGNED_IN_ELSEWHERE);
        expect(browser.close).not.toHaveBeenCalled();
        expect(publish).toHaveBeenCalledWith("ws:broadcast", {
            _from: INSTANCE_ID,
            kind: REVOKE_SESSIONS_KIND,
            tenantId: 3,
            userId: 9,
            sessionIds: ["old"],
            reason: SIGNED_IN_ELSEWHERE,
            keepSessionId: null,
        });
    });

    test("never touches another tenant's user with the same id", () => {
        const otherTenant = socket("old");
        clients.set(clientKey(4, 9), new Set([otherTenant]));
        expect(closeSessionSocketsLocal(3, 9, ["old"], "x")).toBe(0);
        expect(otherTenant.close).not.toHaveBeenCalled();
    });

    test("a password change closes every other session but keeps the caller's", () => {
        const current = socket("me");
        const other = socket("other");
        clients.set(clientKey(3, 9), new Set([current, other]));
        closeOtherSessionSockets(3, 9, "me");
        expect(current.close).not.toHaveBeenCalled();
        expect(other.close).toHaveBeenCalledWith(4001, "Password changed");
    });

    test("nothing revoked means no publish", () => {
        closeSessionSockets(3, 9, [], "x");
        expect(publish).not.toHaveBeenCalled();
    });

    test("signing out a replaced phone removes its push tokens and pushes session_revoked", async () => {
        const oldPhone = socket("old");
        clients.set(clientKey(3, 9), new Set([oldPhone]));
        const query = jest.fn().mockResolvedValue({ rows: [{ device_token: "fcm-old" }], rowCount: 1 });

        signOutRevokedSessions({ db: { query }, tenantId: 3, userId: 9, revoked: [{ sid: "old", deviceId: "device-old1" }] });
        await flush();

        expect(oldPhone.close).toHaveBeenCalledWith(4001, SIGNED_IN_ELSEWHERE);
        expect(query.mock.calls[0][0]).toContain("DELETE FROM device_tokens WHERE user_id = $1 AND device_id = ANY($2)");
        expect(query.mock.calls[0][1]).toEqual([9, ["device-old1"]]);
        expect(sendSessionRevoked).toHaveBeenCalledWith(expect.any(Function), ["fcm-old"], 3);
    });

    test("signing in again on the same phone keeps its push token and sends it no sign-out", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [{ device_token: "fcm-old" }], rowCount: 1 });
        signOutRevokedSessions({
            db: { query }, tenantId: 3, userId: 9, currentDeviceId: "device-same",
            revoked: [{ sid: "old-row", deviceId: "device-same" }, { sid: "other-phone", deviceId: "device-other" }],
        });
        await flush();
        expect(query.mock.calls[0][1]).toEqual([9, ["device-other"]]);
    });

    test("a replaced browser session gets no push", async () => {
        const query = jest.fn();
        signOutRevokedSessions({ db: { query }, tenantId: 3, userId: 9, revoked: [{ sid: "web", deviceId: null }] });
        await flush();
        expect(query).not.toHaveBeenCalled();
        expect(sendSessionRevoked).not.toHaveBeenCalled();
    });
});
