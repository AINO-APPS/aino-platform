import {
    elapsedMinutes,
    formatMinutes,
    summariseTime,
} from "../modules/tasks/tasks.time";

describe("task time tracking", () => {
    test("logged sits against estimated", () => {
        expect(summariseTime({ estimated_minutes: 120, logged_minutes: 45 })).toEqual({
            estimated: 120,
            logged: 45,
            remaining: 75,
            percent: 38,
            over: false,
        });
    });

    test("an overrun is made explicit", () => {
        const summary = summariseTime({ estimated_minutes: 60, logged_minutes: 90 });
        expect(summary.over).toBe(true);
        expect(summary.remaining).toBe(0);
        expect(summary.percent).toBe(150);
    });

    test("an unestimated task reports zero rather than dividing by zero", () => {
        expect(summariseTime({ logged_minutes: 30 })).toEqual({
            estimated: 0,
            logged: 30,
            remaining: 0,
            percent: 0,
            over: false,
        });
    });

    test("minutes format readably", () => {
        expect(formatMinutes(0)).toBe("0m");
        expect(formatMinutes(45)).toBe("45m");
        expect(formatMinutes(60)).toBe("1h");
        expect(formatMinutes(90)).toBe("1h 30m");
    });

    test("elapsed time is measured in whole minutes", () => {
        const start = "2026-10-25T09:00:00Z";
        expect(elapsedMinutes(start, "2026-10-25T09:30:00Z")).toBe(30);
        expect(elapsedMinutes(start, "2026-10-25T09:00:20Z")).toBe(1);
        expect(elapsedMinutes(start, "2026-10-25T08:00:00Z")).toBe(0);
    });
});
