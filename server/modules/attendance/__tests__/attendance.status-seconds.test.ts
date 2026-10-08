import { createAttendanceService } from "../attendance.service";
import { computeStatus } from "../../../utils/timeCalc";

function makeStatusDb(entries: any[], afterAutoLogout?: any[]) {
    const query = jest.fn()
        .mockResolvedValueOnce({ rows: [{ org_id: 2 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ work_hours_per_day: 8, work_days: "1,2,3,4,5" }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: entries, rowCount: entries.length });
    if (afterAutoLogout) query.mockResolvedValueOnce({ rows: afterAutoLogout, rowCount: afterAutoLogout.length });
    // Latest work-mode change request for the day: none.
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    const transaction = jest.fn(async (fn: any) => fn({
        query: jest.fn()
            .mockResolvedValueOnce({ rows: [{ entry_type: "clock_in" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 }),
    }));
    return { query, transaction };
}

const service = createAttendanceService({
    notifyUser: jest.fn(async () => undefined),
    findApprover: jest.fn(),
    sendToUser: jest.fn(),
});

const at = (iso: string) => new Date(iso).getTime();

describe("GET /tracker/status seconds", () => {
    it("returns exact floor seconds while on the floor", async () => {
        const db = makeStatusDb([
            { entry_type: "clock_in", timestamp: "2026-08-21T09:00:00Z", work_mode: "office" },
            { entry_type: "break_start", timestamp: "2026-08-21T10:00:00Z" },
            { entry_type: "break_end", timestamp: "2026-08-21T10:15:30Z" },
        ]);
        const status = await service.getStatus(db as any, 1, "2026-08-21", 5, 0, at("2026-08-21T11:00:45.900Z"));
        expect(status.state).toBe("on_floor");
        // 1h + 45m15s = 6315s; break 15m30s = 930s
        expect(status.floorSeconds).toBe(6315);
        expect(status.breakSeconds).toBe(930);
        expect(status.floorMinutes).toBe(105);
        expect(status.breakMinutes).toBe(15);
        expect(Math.floor(status.floorSeconds / 60)).toBe(status.floorMinutes);
        expect(Math.floor(status.breakSeconds / 60)).toBe(status.breakMinutes);
    });

    it("returns exact break seconds while on break", async () => {
        const db = makeStatusDb([
            { entry_type: "clock_in", timestamp: "2026-08-21T09:00:00Z", work_mode: "office" },
            { entry_type: "break_start", timestamp: "2026-08-21T09:30:10Z" },
        ]);
        const status = await service.getStatus(db as any, 1, "2026-08-21", 5, 0, at("2026-08-21T09:42:59Z"));
        expect(status.state).toBe("on_break");
        expect(status.floorSeconds).toBe(30 * 60 + 10);
        expect(status.breakSeconds).toBe(12 * 60 + 49);
        expect(status.floorMinutes).toBe(30);
        expect(status.breakMinutes).toBe(12);
    });

    it("returns closed-session seconds when logged out, independent of now", async () => {
        const entries = [
            { entry_type: "clock_in", timestamp: "2026-08-21T09:00:00Z", work_mode: "office" },
            { entry_type: "clock_out", timestamp: "2026-08-21T09:20:40Z" },
        ];
        const first = await service.getStatus(makeStatusDb(entries) as any, 1, "2026-08-21", 5, 0, at("2026-08-21T12:00:00Z"));
        const later = await service.getStatus(makeStatusDb(entries) as any, 1, "2026-08-21", 5, 0, at("2026-08-21T18:00:00Z"));
        expect(first.state).toBe("logged_out");
        expect(first.floorSeconds).toBe(20 * 60 + 40);
        expect(first.breakSeconds).toBe(0);
        // Rounding would give 21; minutes are now floored from the seconds.
        expect(first.floorMinutes).toBe(20);
        expect(later.floorSeconds).toBe(first.floorSeconds);
    });

    it("returns zero seconds with no entries", async () => {
        const status = await service.getStatus(makeStatusDb([]) as any, 1, "2026-08-21", 5, 0, at("2026-08-21T12:00:00Z"));
        expect(status).toMatchObject({ state: "logged_out", floorSeconds: 0, breakSeconds: 0, floorMinutes: 0, breakMinutes: 0 });
    });

    it("returns seconds consistent with the auto-logout clock_out", async () => {
        const db = makeStatusDb(
            [{ entry_type: "clock_in", timestamp: "2026-08-21T08:00:00Z", work_mode: "office" }],
            [
                { entry_type: "clock_in", timestamp: "2026-08-21T08:00:00Z", work_mode: "office" },
                { entry_type: "clock_out", timestamp: "2026-08-21T16:00:07Z" },
            ],
        );
        const status = await service.getStatus(db as any, 1, "2026-08-21", 5, 0, at("2026-08-21T16:00:05Z"));
        expect(status.autoLoggedOut).toBe(true);
        expect(status.state).toBe("logged_out");
        expect(status.floorSeconds).toBe(8 * 3600 + 7);
        expect(status.floorMinutes).toBe(480);
        expect(status.dailyTargetMet).toBe(true);
    });

    it("computeStatus keeps floor(seconds/60) === minutes across sub-minute boundaries", () => {
        const entries = [{ entry_type: "clock_in", timestamp: "2026-08-21T09:00:00Z" }] as any;
        for (const s of [0, 29, 30, 59, 60, 89, 90, 3599]) {
            const status = computeStatus(entries, at("2026-08-21T09:00:00Z") + s * 1000 + 999);
            expect(status.floorSeconds).toBe(s);
            expect(status.floorMinutes).toBe(Math.floor(s / 60));
        }
    });
});
