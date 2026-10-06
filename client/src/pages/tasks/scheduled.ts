import { parseLocalDate } from "./utils";

/** Days back (overdue) and ahead covered by the Scheduled tab. */
export const SCHEDULED_PAST_DAYS = 30;
export const SCHEDULED_AHEAD_DAYS = 30;

export interface ScheduledGroup {
  key: string;
  label: string;
  /** `null` for the Overdue bucket. */
  date: string | null;
  tasks: any[];
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const rank = (t: any) => PRIORITY_RANK[t.priority] ?? 1;

function addDays(iso: string, days: number): string {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** `[start_date, end_date]` for `GET /tasks`, relative to `today` (YYYY-MM-DD). */
export function scheduledWindow(today: string): [string, string] {
  return [addDays(today, -SCHEDULED_PAST_DAYS), addDays(today, SCHEDULED_AHEAD_DAYS)];
}

export function nextDays(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(today, i));
}

function dayLabel(day: string, today: string): string {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  return parseLocalDate(day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/**
 * Overdue (past planner date, not done) first, then one section per day from
 * today onward. Completed past tasks are dropped — they are history. Mirrors
 * Android's `groupScheduled`.
 */
export function groupScheduled(tasks: any[], today: string): ScheduledGroup[] {
  const dated = tasks.filter((t) => typeof t.date === "string" && t.date.length >= 10);
  const overdue = dated
    .filter((t) => t.date.slice(0, 10) < today && t.status !== "done")
    .sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b));
  const byDay = new Map<string, any[]>();
  for (const t of dated) {
    const d = t.date.slice(0, 10);
    if (d < today) continue;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(t);
  }
  const groups: ScheduledGroup[] = [];
  if (overdue.length) groups.push({ key: "overdue", label: "Overdue", date: null, tasks: overdue });
  [...byDay.keys()].sort().forEach((d) => {
    const list = byDay.get(d)!.sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || rank(a) - rank(b));
    groups.push({ key: d, label: dayLabel(d, today), date: d, tasks: list });
  });
  return groups;
}
