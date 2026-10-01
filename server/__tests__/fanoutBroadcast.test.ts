export {};

const publish = jest.fn();
jest.mock("../redis", () => ({ publish: (...args: unknown[]) => publish(...args) }));
jest.mock("../services/pushNotifications", () => ({ pushNotifications: {} }));

const { broadcast, broadcastLocal, INSTANCE_ID } = require("../realtime/fanout");
const { clients, clientKey } = require("../realtime/registry");

function socket() {
    return { readyState: 1, send: jest.fn() };
}

describe("tenant-wide broadcast", () => {
    beforeEach(() => {
        clients.clear();
        publish.mockClear();
    });

    test("delivers locally to the tenant only and publishes for other instances", () => {
        const mine = socket();
        const other = socket();
        clients.set(clientKey(7, 1), new Set([mine]));
        clients.set(clientKey(8, 1), new Set([other]));

        broadcast(7, "tenant_features_changed", { features: { chat: true } });

        expect(mine.send).toHaveBeenCalledWith(JSON.stringify({ type: "tenant_features_changed", data: { features: { chat: true } } }));
        expect(other.send).not.toHaveBeenCalled();
        expect(publish).toHaveBeenCalledWith("ws:broadcast", {
            _from: INSTANCE_ID,
            tenantId: 7,
            tenantWide: true,
            type: "tenant_features_changed",
            data: { features: { chat: true } },
        });
    });

    test("local delivery (the Redis subscriber path) never republishes", () => {
        const mine = socket();
        clients.set(clientKey(7, 2), new Set([mine]));

        broadcastLocal(7, "branding_changed", { orgId: 1 });

        expect(mine.send).toHaveBeenCalledTimes(1);
        expect(publish).not.toHaveBeenCalled();
    });
});
