import { localDate, summariseTaskTime } from "../modules/tasks/tasks.timesheet";

describe("task time in the timesheet", () => {
    test("stopped timers group into per-day, per-task rows", () => {
        const days = summariseTaskTime([
            {
                task_id: 7,
                task_title: "Refund webhook",
                issue_key: "PAY-142",
                started_at: "2026-10-25T09:00:00Z",
                stopped_at: "2026-10-25T09:30:00Z",
                minutes: 30,
            },
            {
                task_id: 7,
                task_title: "Refund webhook",
                issue_key: "PAY-142",
                started_at: "2026-10-25T11:00:00Z",
                stopped_at: "2026-10-25T11:15:00Z",
                minutes: 15,
            },
            {
                task_id: 9,
                task_title: "Sprint board",
                issue_key: null,
                started_at: "2026-10-25T13:00:00Z",
                stopped_at: "2026-10-25T14:00:00Z",
                minutes: 60,
            },
        ]);

        expect(days).toHaveLength(1);
        expect(days[0].date).toBe("2026-10-25");
        expect(days[0].minutes).toBe(105);
        expect(days[0].entries).toEqual([
            {
                task_id: 9,
                title: "Sprint board",
                issue_key: null,
                date: "2026-10-25",
                minutes: 60,
            },
            {
                task_id: 7,
                title: "Refund webhook",
                issue_key: "PAY-142",
                date: "2026-10-25",
                minutes: 45,
            },
        ]);
    });

    test("a timer belongs to the local day it started on", () => {
        // 23:30 IST on the 25th is 18:00 UTC — still the 25th locally.
        const days = summariseTaskTime(
            [
                {
                    task_id: 3,
                    task_title: "Late fix",
                    started_at: "2026-10-25T18:00:00Z",
                    stopped_at: "2026-10-25T18:20:00Z",
                    minutes: 20,
                },
            ],
            -330,
        );
        expect(days[0].date).toBe("2026-10-25");
    });

    test("days come back newest first", () => {
        const days = summariseTaskTime([
            { task_id: 1, started_at: "2026-10-24T09:00:00Z", minutes: 10 },
            { task_id: 2, started_at: "2026-10-26T09:00:00Z", minutes: 10 },
        ]);
        expect(days.map((day) => day.date)).toEqual(["2026-10-26", "2026-10-24"]);
    });

    test("zero-minute timers are dropped rather than shown as 0m", () => {
        expect(
            summariseTaskTime([{ task_id: 1, started_at: "2026-10-25T09:00:00Z", minutes: 0 }]),
        ).toEqual([]);
    });

    test("a task without a title still reads sensibly", () => {
        const days = summariseTaskTime([
            { task_id: 42, started_at: "2026-10-25T09:00:00Z", minutes: 5 },
        ]);
        expect(days[0].entries[0].title).toBe("Task #42");
    });

    test("localDate shifts by the viewer's offset", () => {
        expect(localDate("2026-10-25T18:00:00Z", -330)).toBe("2026-10-25");
        expect(localDate("2026-10-25T18:00:00Z", 0)).toBe("2026-10-25");
        expect(localDate("2026-10-25T23:30:00Z", -330)).toBe("2026-10-26");
    });
});
