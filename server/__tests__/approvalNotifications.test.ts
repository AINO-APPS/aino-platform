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
jest.mock("../realtime/fanout", () => ({
    sendToUser: (...args: unknown[]) => fanoutSendToUser(...args),
}));

const {
    notifyApproverOfRequest,
    notifyRequesterOfDecision,
    emitApproverDecision,
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
