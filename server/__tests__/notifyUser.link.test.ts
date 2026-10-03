export {};
/**
 * notifyUser is the single producer for in-app notifications: it persists the
 * row (incl. the deep `link`), emits the WS `notification` frame and sends the
 * FCM alert carrying `link` + `linkTaskId`.
 */

const publish = jest.fn();
jest.mock("../redis", () => ({ publish: (...args: unknown[]) => publish(...args) }));

const sendNotificationAlert = jest.fn().mockResolvedValue({ succeeded: 1, failed: 0 });
jest.mock("../services/pushNotifications", () => ({
    pushNotifications: { sendNotificationAlert: (...args: unknown[]) => sendNotificationAlert(...args) },
}));

const { notifyUser } = require("../realtime/fanout");
const shared = require("../utils/wsHandlers/shared");
const { clients, clientKey } = require("../realtime/registry");

function makeDb() {
    return {
        query: jest.fn(async (sql: string, _params?: unknown[]): Promise<{ rows: any[] }> => {
            if (sql.startsWith("INSERT INTO notifications")) {
                return { rows: [{ id: 501, created_at: "2026-10-02T10:00:00Z" }] };
            }
            if (sql.includes("FROM users")) return { rows: [{ full_name: "Alice", avatar: "/a.png" }] };
            return { rows: [] };
        }),
    };
}

function socket() {
    return { readyState: 1, send: jest.fn() };
}

function sentFrames(ws: { send: jest.Mock }) {
    return ws.send.mock.calls.map(([raw]) => JSON.parse(raw));
}

describe("notifyUser", () => {
    beforeEach(() => {
        clients.clear();
        publish.mockClear();
        sendNotificationAlert.mockClear();
    });

    test("persists link + link_task_id and forwards both over WS and FCM", async () => {
        const db = makeDb();
        const ws = socket();
        clients.set(clientKey(7, 2), new Set([ws]));

        await notifyUser(db, 7, 2, "task", "Task Assigned: X", "Alice assigned you a task", {
            linkTaskId: 42, actorId: 1, link: "/tasks?task=42",
        });

        const [sql, params] = db.query.mock.calls[0];
        expect(sql).toContain("INSERT INTO notifications (user_id, type, title, body, link_task_id, link)");
        expect(params).toEqual([2, "task", "Task Assigned: X", "Alice assigned you a task", 42, "/tasks?task=42"]);

        expect(sentFrames(ws)).toEqual([{
            type: "notification",
            data: {
                id: 501, type: "task", title: "Task Assigned: X", body: "Alice assigned you a task",
                link_task_id: 42, link: "/tasks?task=42", created_at: "2026-10-02T10:00:00Z", is_read: false,
            },
        }]);

        expect(sendNotificationAlert).toHaveBeenCalledWith(expect.any(Function), 2, 7, expect.objectContaining({
            notificationId: 501, type: "task", link: "/tasks?task=42", linkTaskId: 42,
            actorName: "Alice", actorAvatar: "/a.png",
        }));
    });

    test("keeps the legacy positional (linkTaskId, actorId) form working", async () => {
        const db = makeDb();
        await notifyUser(db, 7, 3, "mention", "Mentioned", "In task", 9, 1);

        expect(db.query.mock.calls[0][1]).toEqual([3, "mention", "Mentioned", "In task", 9, null]);
        expect(db.query.mock.calls.some(([s]) => s.includes("FROM users"))).toBe(true);
        expect(sendNotificationAlert).toHaveBeenCalledWith(expect.any(Function), 3, 7, expect.objectContaining({
            link: null, linkTaskId: 9, actorName: "Alice",
        }));
    });

    test("drops non-relative links so clients never open external URLs", async () => {
        const db = makeDb();
        await notifyUser(db, 7, 3, "leave", "Leave Approved", "ok", { link: "https://evil.example" });
        expect(db.query.mock.calls[0][1]![5]).toBeNull();
        expect(sendNotificationAlert.mock.calls[0][3].link).toBeNull();
    });

    test("wsHandlers/shared notifyUser delegates and uses the injected sender", async () => {
        const db = makeDb();
        const sendToUser = jest.fn();
        await shared.notifyUser(db, 7, 4, "approval", "New Leave Request", "Bob submitted", {
            link: "/manager?tab=approvals&request=5",
        }, null, sendToUser);

        expect(sendToUser).toHaveBeenCalledWith(7, 4, "notification", expect.objectContaining({
            id: 501, link: "/manager?tab=approvals&request=5", link_task_id: null,
        }));
        expect(sendNotificationAlert).toHaveBeenCalledTimes(1);
    });

    test("never throws when the insert fails", async () => {
        const db = { query: jest.fn().mockRejectedValue(new Error("db down")) };
        await expect(notifyUser(db, 7, 2, "task", "t", "b", { link: "/tasks?task=1" })).resolves.toBeUndefined();
        expect(sendNotificationAlert).not.toHaveBeenCalled();
    });
});
