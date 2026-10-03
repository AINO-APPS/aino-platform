import { createAttendanceService } from "../attendance.service";
import { parseManualEntry } from "../attendance.schema";

/**
 * Manual entries need approval for every role, and adding an entry on a date
 * that already has attendance becomes an edit request instead of an error.
 */

type Sql = [string, unknown[]];

function setup(dbResults: Array<{ rows: any[]; rowCount: number }>, approverId: number | null = 9) {
    const client = { query: jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [{ id: 41 }], rowCount: 1 })) };
    const db = {
        query: jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] as any[], rowCount: 0 })),
        transaction: jest.fn(async (fn: any) => fn(client)),
    };
    for (const result of dbResults) db.query.mockResolvedValueOnce(result);
    const findApprover = jest.fn(async () => (approverId ? { id: approverId } : null));
    const service = createAttendanceService({
        notifyUser: jest.fn(async () => undefined),
        findApprover,
        sendToUser: jest.fn(),
    });
    return { client, db, service, findApprover, txSql: () => client.query.mock.calls as unknown as Sql[] };
}

const actor = { userId: 1, orgId: 2, tenantId: 3 };
const none = { rows: [], rowCount: 0 };
const manual = () => parseManualEntry({
    date: "2026-08-21", clock_in: "09:30", clock_out: "18:00",
    breaks: [{ start: "13:00", end: "13:30" }], work_mode: "remote",
}, { today: "2026-08-21" });

describe("createManualEntry on a date that already has entries", () => {
    it("files a pending edit request and leaves the existing entries untouched", async () => {
        const { db, service, txSql } = setup([
            { rows: [{ count: "3" }], rowCount: 1 }, // entries exist
            none,                                    // pay period not locked
            none,                                    // no leave
            { rows: [{ value: 1 }], rowCount: 1 },   // applied attendance (real clock-in / approved)
        ]);

        const result = await service.createManualEntry(db as any, actor, manual(), "+0 minutes");

        expect(result).toEqual({
            approvalStatus: "pending",
            needsApproval: true,
            approverId: 9,
            hasProtectedData: true,
            approvalId: 41,
            existingEntries: true,
        });
        const sql = txSql();
        expect(sql.some(([q]) => /INSERT INTO time_entries|DELETE FROM time_entries/.test(q))).toBe(false);
        expect(sql[0][0]).toMatch(/Superseded by edit/); // earlier pending request for the date closed
        expect(sql[1][0]).toMatch(/UPDATE time_entries SET approval_status = 'rejected'/); // ...and its pending rows
        const insert = sql.find(([q]) => /INSERT INTO approval_requests/.test(q))!;
        expect(JSON.parse(String(insert[1][4]))).toEqual({
            date: "2026-08-21", clock_in: "09:30", clock_out: "18:00",
            breaks: [{ start: "13:00", end: "13:30" }], work_mode: "remote",
            timezone_offset: 0, edit: true,
        });
    });

    it("replaces only unapproved manual rows with new pending rows when nothing is applied yet", async () => {
        const { db, service, txSql } = setup([
            { rows: [{ count: "2" }], rowCount: 1 },
            none,
            none,
            none, // only pending/rejected manual rows on the date
        ]);

        const result = await service.createManualEntry(db as any, actor, manual(), "+0 minutes");

        expect(result).toMatchObject({ approvalStatus: "pending", needsApproval: true, hasProtectedData: false, existingEntries: true });
        const sql = txSql();
        expect(sql[0][0]).toMatch(/Superseded by edit/);
        expect(sql.some(([q]) => /DELETE FROM time_entries/.test(q))).toBe(true);
        const inserted = sql.filter(([q]) => /INSERT INTO time_entries/.test(q));
        expect(inserted).toHaveLength(4);
        expect(inserted.every(([, p]) => p[4] === "pending")).toBe(true);
        expect(sql.some(([q]) => /INSERT INTO approval_requests/.test(q))).toBe(true);
    });

    it("still refuses dates with a leave", async () => {
        const { db, service, client } = setup([
            { rows: [{ count: "1" }], rowCount: 1 },
            none,
            { rows: [{ id: 5, leave_type: "sick" }], rowCount: 1 },
        ]);

        await expect(service.createManualEntry(db as any, actor, manual(), "+0 minutes"))
            .rejects.toThrow("You have a sick leave on this date");
        expect(client.query).not.toHaveBeenCalled();
    });

    it("still refuses locked pay periods", async () => {
        const { db, service, client } = setup([
            { rows: [{ count: "1" }], rowCount: 1 },
            { rows: [{ label: "Aug 2026" }], rowCount: 1 },
        ]);

        await expect(service.createManualEntry(db as any, actor, manual(), "+0 minutes"))
            .rejects.toThrow("locked pay period (Aug 2026)");
        expect(client.query).not.toHaveBeenCalled();
    });
});

describe("manual entries need approval for every role", () => {
    it("creates pending rows plus an approval request on an empty date (no role bypass)", async () => {
        // A super admin with no one above them resolves to themselves as approver.
        const { db, service, txSql } = setup([{ rows: [{ count: "0" }], rowCount: 1 }, none, none], 1);

        const result = await service.createManualEntry(db as any, actor, manual(), "+0 minutes");

        expect(result).toMatchObject({ approvalStatus: "pending", needsApproval: true, approverId: 1, existingEntries: false });
        const sql = txSql();
        expect(sql.filter(([q]) => /INSERT INTO time_entries/.test(q)).every(([, p]) => p[4] === "pending")).toBe(true);
        expect(sql.some(([q]) => /INSERT INTO approval_requests/.test(q))).toBe(true);
    });

    it("routes edits of applied attendance through an approval request", async () => {
        const { db, service, txSql } = setup([none, none, { rows: [{ value: 1 }], rowCount: 1 }]);
        const edit = parseManualEntry({ clock_in: "08:00", clock_out: "16:00" }, {
            date: "2026-08-21", today: "2026-08-21", edit: true,
        });

        const result = await service.editManualEntry(db as any, actor, edit, "+0 minutes");

        expect(result).toMatchObject({ approvalStatus: "pending", needsApproval: true, hasProtectedData: true });
        expect(txSql().some(([q]) => /INSERT INTO time_entries|DELETE FROM time_entries/.test(q))).toBe(false);
    });
});

describe("superseding a plain manual request with a protected edit", () => {
    it("rejects the superseded request's pending manual rows for the local day in the same transaction", async () => {
        const { db, service, txSql } = setup([none, none, { rows: [{ value: 1 }], rowCount: 1 }]);
        const edit = parseManualEntry({ clock_in: "09:00", clock_out: "18:00", timezoneOffset: -330 }, {
            date: "2026-08-21", today: "2026-08-21", edit: true,
        });

        await service.editManualEntry(db as any, actor, edit, "+330 minutes");

        expect(db.transaction).toHaveBeenCalledTimes(1);
        const sql = txSql();
        expect(sql[0][0]).toMatch(/UPDATE approval_requests[\s\S]*Superseded by edit/);
        expect(sql[1][0]).toMatch(/UPDATE time_entries SET approval_status = 'rejected'/);
        expect(sql[1][0]).toMatch(/is_manual = TRUE AND approval_status = 'pending'/);
        expect(sql[1][0]).toMatch(/\(timestamp \+ \$3::interval\)::date = \$2::date/);
        expect(sql[1][1]).toEqual([1, "2026-08-21", "+330 minutes"]);
        const insert = sql.find(([q]) => /INSERT INTO approval_requests/.test(q))!;
        expect(JSON.parse(String(insert[1][4]))).toMatchObject({ timezone_offset: -330, edit: true });
    });

    it("stores the request's timezone_offset on plain manual requests", async () => {
        const { db, service, txSql } = setup([{ rows: [{ count: "0" }], rowCount: 1 }, none, none]);
        const plain = parseManualEntry({
            date: "2026-08-21", clock_in: "09:00", clock_out: "18:00", timezoneOffset: -330,
        }, { today: "2026-08-21" });

        await service.createManualEntry(db as any, actor, plain, "+330 minutes");

        const insert = txSql().find(([q]) => /INSERT INTO approval_requests/.test(q))!;
        expect(JSON.parse(String(insert[1][4]))).toMatchObject({ date: "2026-08-21", timezone_offset: -330 });
        expect(JSON.parse(String(insert[1][4])).edit).toBeUndefined();
    });
});
