import { describe, expect, it } from "vitest";
import { groupScheduled, nextDays, scheduledWindow } from "../pages/tasks/scheduled";

const t = (id: number, date: string | null, extra: Record<string, unknown> = {}) => ({ id, date, status: "pending", priority: "medium", ...extra });

describe("Scheduled tab grouping", () => {
  const today = "2026-10-06";

  it("computes the fetch window and week strip", () => {
    expect(scheduledWindow(today)).toEqual(["2026-09-06", "2026-11-05"]);
    expect(nextDays(today, 3)).toEqual(["2026-10-06", "2026-10-07", "2026-10-08"]);
  });

  it("puts open past tasks in Overdue, drops done past tasks and undated rows", () => {
    const groups = groupScheduled(
      [
        t(1, "2026-10-04"),
        t(2, "2026-10-03", { status: "done" }),
        t(3, "2026-10-06", { priority: "low" }),
        t(4, "2026-10-06", { priority: "high" }),
        t(5, "2026-10-07"),
        t(6, "2026-10-12"),
        t(7, null),
      ],
      today,
    );
    expect(groups.map((g) => g.label)).toEqual(["Overdue", "Today", "Tomorrow", "Mon, Oct 12"]);
    expect(groups[0].tasks.map((x) => x.id)).toEqual([1]);
    expect(groups[1].tasks.map((x) => x.id)).toEqual([4, 3]);
    expect(groups[0].date).toBeNull();
  });

  it("lists done tasks after open ones within a day", () => {
    const [day] = groupScheduled([t(1, today, { status: "done", priority: "high" }), t(2, today, { priority: "low" })], today);
    expect(day.tasks.map((x) => x.id)).toEqual([2, 1]);
  });
});
