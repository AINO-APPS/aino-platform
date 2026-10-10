export {};
/**
 * Shared realtime helpers: approval notifications (deep links + events) and
 * the team_attendance_update fan-out to managers/approvers.
 */

const notifyUser = jest.fn().mockResolvedValue(undefined);
const wsSendToUser = jest.fn();
jest.mock("../utils/ws", () => ({
    notifyUser: (...args: unknown[]) => notifyUser(...args),
    sendToUser: (...args: unknown[]) => wsSendToUser(...args),
}));
const fanoutSendToUser = jest.fn();
jest.mock("../redis", () => ({
    getOrgRolesMap: jest.fn().mockResolvedValue(null),
    setOrgRolesMap: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../realtime/fanout", () => ({
    sendToUser: (...args: unknown[]) => fanoutSendToUser(...args),
}));

const {
    notifyApproverOfRequest,
    notifyRequesterOfDecision,
    emitApproverDecision,
    emitApprovalDecisions,
} = require("../utils/approvalNotifications");
const { emitTeamAttendanceUpdate } = require("../utils/teamAttendanceRealtime");
const { approvalLink, taskLink, noteLink } = require("../utils/notificationLinks");

function db(routes: Array<[RegExp, any[]]>) {
    return {
        query: jest.fn(async (sql: string) => {
            for (const [re, rows] of routes) if (re.test(sql)) return { rows };
            return { rows: [] };
        }),
    };
}

beforeEach(() => {
    notifyUser.mockClear();
    wsSendToUser.mockClear();
    fanoutSendToUser.mockClear();
});

describe("notification links", () => {
    test("are relative web paths", () => {
        expect(taskLink(42)).toBe("/tasks?task=42");
        expect(noteLink("abc-1")).toBe("/notes?pageId=abc-1");
        expect(approvalLink(5)).toBe("/manager?tab=approvals&request=5");
        expect(approvalLink(null)).toBe("/manager?tab=approvals");
    });
});

describe("approval notifications", () => {
    test.each(["leave", "leave_withdraw", "manual_entry", "overtime", "work_mode_change"])(
        "%s decisions reach only authorized same-org viewers, including custom admin roles",
        async (type) => {
            const d = db([
                [/SELECT id, org_id, manager_id FROM users/, [{ id: 2, org_id: 1, manager_id: 9 }]],
                [/SELECT role_key, permission_level FROM tenant_roles/, [
                    { role_key: "people_ops", permission_level: 4 },
                    { role_key: "hr_admin", permission_level: 1 },
                ]],
                [/SELECT id, role, org_id FROM users/, [
                    { id: 1, org_id: 1, role: "manager" },
                    { id: 9, org_id: 1, role: "manager" },
                    { id: 10, org_id: 1, role: "team_lead" },
                    { id: 11, org_id: 1, role: "people_ops" },
                    { id: 12, org_id: 2, role: "super_admin" },
                    { id: 13, org_id: 1, role: "employee" },
                    { id: 14, org_id: 1, role: "hr_admin" },
                    { id: 2, org_id: 1, role: "people_ops" },
                    { id: 9, org_id: 1, role: "manager" },
                ]],
            ]);
            await emitApprovalDecisions(d, 7, 1, [
                { approvalId: 77, requesterId: 2, originalApproverId: 10, type },
            ], "approved");
            expect(wsSendToUser.mock.calls.map((c: unknown[]) => c[1])).toEqual([1, 9, 10, 11]);
            expect(wsSendToUser.mock.calls.every((c: unknown[]) => c[0] === 7)).toBe(true);
            expect(d.query.mock.calls.at(-1)?.[0]).toContain("is_active = TRUE");
        },
    );

    test("actor synchronization happens before a delayed or failed recipient lookup", async () => {
        let reject!: (reason: Error) => void;
        const d = { query: jest.fn(() => new Promise<never>((_resolve, fail) => { reject = fail; })) };
        const pending = emitApprovalDecisions(d, 7, 1, [
            { approvalId: 77, requesterId: 2, type: "leave" },
        ], "rejected");
        expect(wsSendToUser).toHaveBeenCalledWith(7, 1, "approval_update", { id: 77, type: "leave", status: "rejected" });
        reject(new Error("lookup failed"));
        await expect(pending).rejects.toThrow("lookup failed");
    });

    test("bulk recipient lookup is batched and empty/skipped batches emit nothing", async () => {
        const d = db([
            [/SELECT id, org_id, manager_id FROM users/, [{ id: 2, org_id: 1, manager_id: 9 }]],
            [/SELECT id, role, org_id FROM users/, [{ id: 9, org_id: 1, role: "manager" }]],
        ]);
        await emitApprovalDecisions(d, 7, 1, [], "approved");
        expect(wsSendToUser).not.toHaveBeenCalled();
        await emitApprovalDecisions(d, 7, 1, [
            { approvalId: 77, requesterId: 2, originalApproverId: 9, type: "leave" },
            { approvalId: 78, requesterId: 2, originalApproverId: 9, type: "manual_entry" },
        ], "approved");
        expect(wsSendToUser.mock.calls.map((c: unknown[]) => c[1])).toEqual([1, 9, 9]);
        expect(d.query).toHaveBeenCalledTimes(3);
        expect(wsSendToUser).toHaveBeenCalledWith(7, 1, "approval_update", { type: "bulk", status: "approved" });
    });

    test("approver gets an approval deep link + approval_update with the request id", async () => {
        const d = db([[/SELECT full_name FROM users/, [{ full_name: "Ann" }]]]);
        await notifyApproverOfRequest(d, 7, {
            approverId: 9, requesterId: 2, type: "leave", approvalId: 77,
            title: "New Leave Request", body: (n: string) => `${n} asked`,
        });
        expect(notifyUser).toHaveBeenCalledWith(d, 7, 9, "approval", "New Leave Request", "Ann asked", {
            actorId: 2, link: "/manager?tab=approvals&request=77",
        });
        expect(wsSendToUser).toHaveBeenCalledWith(7, 9, "approval_update", { id: 77, type: "leave", status: "pending" });
    });

    test("leave decisions link to /attendance#leaves and emit leave_update", async () => {
        await notifyRequesterOfDecision(db([]), 7, {
            requesterId: 2, actorId: 1, kind: "leave", status: "rejected", leaveId: 11, approvalId: 77,
            title: "Leave Rejected", body: "No",
        });
        expect(notifyUser.mock.calls[0].slice(2)).toEqual([2, "leave", "Leave Rejected", "No", { actorId: 1, link: "/attendance#leaves" }]);
        expect(wsSendToUser).toHaveBeenCalledWith(7, 2, "leave_update", { id: 11, status: "rejected" });
    });

    test("manual entry / overtime decisions link to /attendance#manual-entry and emit approval_update", async () => {
        await notifyRequesterOfDecision(db([]), 7, {
            requesterId: 2, actorId: 1, kind: "overtime", status: "approved", approvalId: 78,
            title: "Overtime Approved", body: "Yes",
        });
        expect(notifyUser.mock.calls[0].slice(2)).toEqual([2, "approval", "Overtime Approved", "Yes", { actorId: 1, link: "/attendance#manual-entry" }]);
        expect(wsSendToUser).toHaveBeenCalledWith(7, 2, "approval_update", { id: 78, type: "overtime", status: "approved" });
    });

    test("approver decision sync omits the id when unknown and skips missing approvers", () => {
        emitApproverDecision(7, 1, "leave", "revoked");
        emitApproverDecision(7, null, "leave", "cancelled");
        expect(wsSendToUser).toHaveBeenCalledTimes(1);
        expect(wsSendToUser).toHaveBeenCalledWith(7, 1, "approval_update", { type: "leave", status: "revoked" });
    });
});

describe("team_attendance_update", () => {
    test("goes to the direct manager and the resolved approver, deduped, never to self", async () => {
        const d = db([
            [/SELECT manager_id, org_id FROM users/, [{ manager_id: 9, org_id: 1 }]],
            [/SELECT manager_id, team_id, department_id FROM users/, [{ manager_id: 9 }]],
            [/SELECT id FROM users WHERE id = \$1 AND is_active = TRUE/, [{ id: 9 }]],
        ]);
        await emitTeamAttendanceUpdate(d, 7, 2, "clock_in");
        expect(fanoutSendToUser).toHaveBeenCalledTimes(1);
        expect(fanoutSendToUser).toHaveBeenCalledWith(7, 9, "team_attendance_update", { userId: 2, action: "clock_in" });
    });

    test("falls back to the approver chain (e.g. HR) when there is no manager", async () => {
        const d = db([
            [/SELECT manager_id, org_id FROM users/, [{ manager_id: null, org_id: 1 }]],
            [/role IN \('hr_admin','super_admin'\)/, [{ id: 4 }]],
        ]);
        await emitTeamAttendanceUpdate(d, 7, 2, "manual_entry");
        expect(fanoutSendToUser).toHaveBeenCalledWith(7, 4, "team_attendance_update", { userId: 2, action: "manual_entry" });
    });

    test("is best-effort when lookups fail", async () => {
        const d = { query: jest.fn().mockRejectedValue(new Error("db down")) };
        await expect(emitTeamAttendanceUpdate(d, 7, 2, "break_start")).resolves.toBeUndefined();
        expect(fanoutSendToUser).not.toHaveBeenCalled();
    });
});
