import { describe, expect, it } from "vitest";
import { groupScheduled, nextDays, scheduledWindow, scheduleDateOf } from "../pages/tasks/scheduled";

const t = (id: number, planned_date: string | null, extra: Record<string, unknown> = {}) => ({ id, planned_date, priority: "medium", ...extra });

describe("Scheduled tab grouping", () => {
  const today = "2026-10-06";

  it("reads the planned date first, then the due date", () => {
    expect(scheduleDateOf({ planned_date: "2026-10-09T00:00:00Z", due_date: "2026-10-20" })).toBe("2026-10-09");
    expect(scheduleDateOf({ planned_date: null, due_date: "2026-10-20" })).toBe("2026-10-20");
    expect(scheduleDateOf({ planned_date: null, due_date: null })).toBeNull();
  });

  it("computes the fetch window and week strip", () => {
    expect(scheduledWindow(today)).toEqual(["2026-09-06", "2026-11-05"]);
    expect(nextDays(today, 3)).toEqual(["2026-10-06", "2026-10-07", "2026-10-08"]);
  });

  it("puts open past tasks in Overdue, keeps recently done ones on their day, drops undated rows", () => {
    const groups = groupScheduled(
      [
        t(1, "2026-10-04"),
        t(2, "2026-10-03", { completed_at: "2026-10-03T10:00:00Z" }),
        t(3, "2026-10-06", { priority: "low" }),
        t(4, "2026-10-06", { priority: "high" }),
        t(5, "2026-10-07"),
        t(6, "2026-10-12"),
        t(7, null),
      ],
      today,
    );
    expect(groups.map((g) => g.label)).toEqual([
      "Overdue", "Sat, Oct 3", "Today", "Tomorrow", "Mon, Oct 12",
    ]);
    expect(groups[0].tasks.map((x) => x.id)).toEqual([1]);
    expect(groups[1].tasks.map((x) => x.id)).toEqual([2]);
    expect(groups[2].tasks.map((x) => x.id)).toEqual([4, 3]);
    expect(groups[0].date).toBeNull();
  });

  it("groups by the due date when a ticket has no planned date", () => {
    const groups = groupScheduled(
      [t(1, null, { due_date: "2026-10-07" }), t(2, null, { due_date: "2026-10-01" }), t(3, "2026-10-07", { due_date: "2026-10-20" })],
      today,
    );
    expect(groups.map((g) => g.label)).toEqual(["Overdue", "Tomorrow"]);
    expect(groups[0].tasks.map((x) => x.id)).toEqual([2]);
    // The planned date wins over the due date.
    expect(groups[1].tasks.map((x) => x.id).sort()).toEqual([1, 3]);
  });

  it("collects tickets beyond the 30-day horizon under Later so none go missing", () => {
    const groups = groupScheduled(
      [t(1, "2026-11-04"), t(2, "2026-11-06"), t(3, null, { due_date: "2027-01-15" })],
      today,
    );
    expect(groups.map((g) => g.key)).toEqual(["2026-11-04", "later"]);
    const later = groups[1];
    expect(later.label).toBe("Later");
    expect(later.date).toBeNull();
    expect(later.tasks.map((x) => x.id)).toEqual([2, 3]);
  });

  it("keeps a ticket completed within the history window on its past day", () => {
    const groups = groupScheduled(
      [
        t(1, "2026-10-02", { completed_at: "2026-10-02T09:00:00Z" }),
        t(2, "2026-10-02"),
        t(3, "2026-09-01", { completed_at: "2026-09-01T09:00:00Z" }),
      ],
      today,
    );
    // Open and recently finished work share the day; history older than the
    // 30-day window is dropped.
    expect(groups.map((g) => g.key)).toEqual(["overdue", "2026-10-02"]);
    expect(groups[0].tasks.map((x) => x.id)).toEqual([2]);
    expect(groups[1].tasks.map((x) => x.id)).toEqual([1]);
  });

  it("lists done tasks after open ones within a day", () => {
    const [day] = groupScheduled([t(1, today, { completed_at: "2026-10-06T10:00:00Z", priority: "high" }), t(2, today, { priority: "low" })], today);
    expect(day.tasks.map((x) => x.id)).toEqual([2, 1]);
  });
});
