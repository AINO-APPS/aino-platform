import { summariseTaskTime } from "../modules/tasks/tasks.timesheet";

describe("task time in the timesheet", () => {
    test("worklogs group into per-day, per-task rows", () => {
        const days = summariseTaskTime([
            {
                task_id: 7,
                task_title: "Refund webhook",
                ticket_key: "PAY-142",
                day_worked: "2026-10-25",
                minutes: 30,
            },
            {
                task_id: 7,
                task_title: "Refund webhook",
                ticket_key: "PAY-142",
                day_worked: "2026-10-25",
                minutes: 15,
            },
            {
                task_id: 9,
                task_title: "Sprint board",
                ticket_key: null,
                day_worked: "2026-10-25",
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
                ticket_key: null,
                date: "2026-10-25",
                minutes: 60,
            },
            {
                task_id: 7,
                title: "Refund webhook",
                ticket_key: "PAY-142",
                date: "2026-10-25",
                minutes: 45,
            },
        ]);
    });

    test("days come back newest first", () => {
        const days = summariseTaskTime([
            { task_id: 1, day_worked: "2026-10-24", minutes: 10 },
            { task_id: 2, day_worked: "2026-10-26", minutes: 10 },
        ]);
        expect(days.map((day) => day.date)).toEqual(["2026-10-26", "2026-10-24"]);
    });

    test("zero-minute worklogs are dropped rather than shown as 0m", () => {
        expect(
            summariseTaskTime([{ task_id: 1, day_worked: "2026-10-25", minutes: 0 }]),
        ).toEqual([]);
    });

    test("a task without a title still reads sensibly", () => {
        const days = summariseTaskTime([
            { task_id: 42, day_worked: "2026-10-25", minutes: 5 },
        ]);
        expect(days[0].entries[0].title).toBe("Task #42");
    });
});
