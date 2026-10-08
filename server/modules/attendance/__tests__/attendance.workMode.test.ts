import { createWorkModeService } from "../attendance.workMode";
import { AttendanceError, WorkModeLockedError } from "../attendance.types";
import { parseWorkModeRequest } from "../attendance.schema";

interface Request { id: number; status: string; date: string; work_mode: string }

/** Minimal fake routing the module's queries by shape. */
function fakeDb(state: { firstMode: string | null; requests: Request[] }) {
    const inserted: unknown[][] = [];
    const query = jest.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("FROM time_entries") && sql.includes("entry_type = 'clock_in'")) {
            return state.firstMode ? { rows: [{ work_mode: state.firstMode }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        if (sql.includes("INSERT INTO approval_requests")) {
            inserted.push(params);
            const meta = JSON.parse(String(params[4]));
            state.requests.push({ id: 99, status: "pending", date: meta.date, work_mode: meta.work_mode });
            return { rows: [{ id: 99 }], rowCount: 1 };
        }
        if (sql.includes("type = 'work_mode_change'") && sql.includes("status = 'approved'")) {
            const hit = state.requests.some((r) => r.status === "approved" && r.date === params[1] && r.work_mode === params[2]);
            return { rows: hit ? [{}] : [], rowCount: hit ? 1 : 0 };
        }
        if (sql.includes("type = 'work_mode_change'") && sql.includes("status = 'pending'")) {
            const hit = state.requests.some((r) => r.status === "pending" && r.date === params[1]);
            return { rows: hit ? [{}] : [], rowCount: hit ? 1 : 0 };
        }
        if (sql.includes("SELECT full_name FROM users")) return { rows: [{ full_name: "Asha" }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
    });
    return { db: { query }, inserted };
}

const actor = { userId: 7, orgId: 2, tenantId: 3 };
const TODAY = "2026-10-08";

function service(overrides: Partial<Parameters<typeof createWorkModeService>[0]> = {}) {
    return createWorkModeService({
        findApprover: jest.fn(async () => ({ id: 11 })),
        sendToUser: jest.fn(),
        notifyUser: jest.fn(async () => undefined),
        ...overrides,
    });
}

describe("work-mode lock", () => {
    it("allows any mode for the first clock-in of the day", async () => {
        const { db } = fakeDb({ firstMode: null, requests: [] });
        await expect(service().assertWorkModeAllowed(db as any, 7, TODAY, "330 minutes", "remote")).resolves.toBeUndefined();
    });

    it("allows clocking in again with the same mode", async () => {
        const { db } = fakeDb({ firstMode: "office", requests: [] });
        await expect(service().assertWorkModeAllowed(db as any, 7, TODAY, "330 minutes", "office")).resolves.toBeUndefined();
    });

    it("refuses a different mode without an approved change", async () => {
        const { db } = fakeDb({ firstMode: "office", requests: [] });
        const error = await service().assertWorkModeAllowed(db as any, 7, TODAY, "330 minutes", "remote").catch((e) => e);
        expect(error).toBeInstanceOf(WorkModeLockedError);
        expect(error.statusCode).toBe(409);
        expect(error.lockedMode).toBe("office");
    });

    it("a pending or rejected request does not unlock the mode", async () => {
        const { db } = fakeDb({ firstMode: "office", requests: [
            { id: 1, status: "pending", date: TODAY, work_mode: "remote" },
            { id: 2, status: "rejected", date: TODAY, work_mode: "remote" },
        ] });
        await expect(service().assertWorkModeAllowed(db as any, 7, TODAY, "330 minutes", "remote")).rejects.toBeInstanceOf(WorkModeLockedError);
    });

    it("an approved change for today allows the requested mode", async () => {
        const { db } = fakeDb({ firstMode: "office", requests: [{ id: 1, status: "approved", date: TODAY, work_mode: "remote" }] });
        await expect(service().assertWorkModeAllowed(db as any, 7, TODAY, "330 minutes", "remote")).resolves.toBeUndefined();
    });

    it("yesterday's approval does not carry over", async () => {
        const { db } = fakeDb({ firstMode: "office", requests: [{ id: 1, status: "approved", date: "2026-10-07", work_mode: "remote" }] });
        await expect(service().assertWorkModeAllowed(db as any, 7, TODAY, "330 minutes", "remote")).rejects.toBeInstanceOf(WorkModeLockedError);
    });
});

describe("work-mode change request", () => {
    const input = { date: TODAY, workMode: "remote", reason: "Plumber at home", timezoneModifier: "330 minutes" };

    it("persists the request and notifies the approver", async () => {
        const { db, inserted } = fakeDb({ firstMode: "office", requests: [] });
        const sendToUser = jest.fn();
        const notifyUser = jest.fn(async () => undefined);
        const result = await service({ sendToUser, notifyUser }).createWorkModeChangeRequest(db as any, actor, input);
        expect(result).toEqual({ approvalId: 99, approverId: 11 });
        expect(JSON.parse(String(inserted[0][4]))).toEqual({ date: TODAY, work_mode: "remote", from_mode: "office" });
        expect(notifyUser).toHaveBeenCalledWith(db, 3, 11, "approval", "Work Mode Change Request", expect.stringContaining("office to remote"), expect.anything());
        expect(sendToUser).toHaveBeenCalledWith(3, 11, "approval_update", { id: 99, type: "work_mode_change", status: "pending" });
    });

    it("needs a clock-in first", async () => {
        const { db } = fakeDb({ firstMode: null, requests: [] });
        await expect(service().createWorkModeChangeRequest(db as any, actor, input)).rejects.toThrow(/haven't clocked in/);
    });

    it("rejects asking for the mode already in use", async () => {
        const { db } = fakeDb({ firstMode: "remote", requests: [] });
        await expect(service().createWorkModeChangeRequest(db as any, actor, input)).rejects.toThrow(/already remote/);
    });

    it("allows only one pending request per day", async () => {
        const { db } = fakeDb({ firstMode: "office", requests: [{ id: 1, status: "pending", date: TODAY, work_mode: "remote" }] });
        const error = await service().createWorkModeChangeRequest(db as any, actor, input).catch((e) => e);
        expect(error).toBeInstanceOf(AttendanceError);
        expect(error.statusCode).toBe(409);
    });

    it("approval then unlocks the next clock-in", async () => {
        const state = { firstMode: "office", requests: [] as Request[] };
        const { db } = fakeDb(state);
        const svc = service();
        await svc.createWorkModeChangeRequest(db as any, actor, input);
        await expect(svc.assertWorkModeAllowed(db as any, 7, TODAY, "330 minutes", "remote")).rejects.toBeInstanceOf(WorkModeLockedError);
        state.requests[0].status = "approved";
        await expect(svc.assertWorkModeAllowed(db as any, 7, TODAY, "330 minutes", "remote")).resolves.toBeUndefined();
    });
});

describe("status work-mode fields", () => {
    it("reports today's locked mode and the latest request", async () => {
        const { createAttendanceService } = require("../attendance.service");
        const query = jest.fn()
            .mockResolvedValueOnce({ rows: [{ org_id: 2 }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ work_hours_per_day: 8, work_days: "1,2,3,4,5" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [
                { entry_type: "clock_in", timestamp: "2026-10-08T03:30:00Z", work_mode: "office" },
                { entry_type: "clock_out", timestamp: "2026-10-08T05:30:00Z" },
            ], rowCount: 2 })
            .mockResolvedValueOnce({ rows: [{ id: 5, status: "pending", work_mode: "remote", reject_reason: null }], rowCount: 1 });
        const svc = createAttendanceService({ notifyUser: jest.fn(), findApprover: jest.fn(), sendToUser: jest.fn() });
        const status = await svc.getStatus({ query } as any, 7, TODAY, 4, -330, new Date("2026-10-08T06:00:00Z").getTime());
        expect(status.lockedWorkMode).toBe("office");
        expect(status.workModeRequest).toEqual({ id: 5, status: "pending", workMode: "remote", rejectReason: null });
    });
});

describe("parseWorkModeRequest", () => {
    it("accepts a valid body", () => {
        expect(parseWorkModeRequest({ work_mode: "remote", reason: " Sick child " })).toEqual({ workMode: "remote", reason: "Sick child" });
    });
    it.each([
        [{ work_mode: "beach", reason: "x" }, /office, remote or hybrid/],
        [{ work_mode: "remote" }, /reason/],
        [{ work_mode: "remote", reason: "x".repeat(501) }, /500/],
    ])("rejects invalid bodies", (body, error) => {
        expect(() => parseWorkModeRequest(body)).toThrow(error);
    });
});
