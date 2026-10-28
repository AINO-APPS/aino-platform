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

/** The day a scheduled ticket sits on: its planned date, else its due date. */
export function scheduleDateOf(task: any): string | null {
  for (const value of [task?.planned_date, task?.due_date]) {
    if (typeof value === "string" && value.length >= 10) return value.slice(0, 10);
  }
  return null;
}

const byDoneThenPriority = (a: any, b: any) =>
  Number(!!a.completed_at) - Number(!!b.completed_at) || rank(a) - rank(b);

/**
 * Overdue (past date, not done) first, then one section per day for the next
 * 30 days, then everything further out under "Later" so no dated ticket goes
 * missing now that dated work has left the backlog. A ticket's day is its
 * planned date, else its due date. Completed past tasks are dropped — they are
 * history. Mirrors Android's `groupScheduled`.
 */
export function groupScheduled(tasks: any[], today: string): ScheduledGroup[] {
  const horizon = addDays(today, SCHEDULED_AHEAD_DAYS - 1);
  const dated = tasks
    .map((t) => ({ t, d: scheduleDateOf(t) }))
    .filter((x): x is { t: any; d: string } => x.d !== null);
  // History window: a ticket finished within the last 30 days keeps its day
  // (the server applies the same window). Older finished work is history.
  const historyFrom = addDays(today, -SCHEDULED_PAST_DAYS);
  const finishedWithin = (t: any) =>
    Boolean(t.completed_at) && String(t.completed_at).slice(0, 10) >= historyFrom;
  const overdue = dated
    .filter(({ t, d }) => d < today && !t.completed_at)
    .sort((a, b) => a.d.localeCompare(b.d) || rank(a.t) - rank(b.t))
    .map(({ t }) => t);
  const byDay = new Map<string, any[]>();
  const later: Array<{ t: any; d: string }> = [];
  for (const entry of dated) {
    if (entry.d < today) {
      if (!finishedWithin(entry.t)) continue;
      if (!byDay.has(entry.d)) byDay.set(entry.d, []);
      byDay.get(entry.d)!.push(entry.t);
      continue;
    }
    if (entry.d > horizon) {
      later.push(entry);
      continue;
    }
    if (!byDay.has(entry.d)) byDay.set(entry.d, []);
    byDay.get(entry.d)!.push(entry.t);
  }
  const groups: ScheduledGroup[] = [];
  if (overdue.length) groups.push({ key: "overdue", label: "Overdue", date: null, tasks: overdue });
  [...byDay.keys()].sort().forEach((d) => {
    groups.push({ key: d, label: dayLabel(d, today), date: d, tasks: byDay.get(d)!.sort(byDoneThenPriority) });
  });
  if (later.length) {
    later.sort((a, b) => a.d.localeCompare(b.d) || byDoneThenPriority(a.t, b.t));
    groups.push({ key: "later", label: "Later", date: null, tasks: later.map(({ t }) => t) });
  }
  return groups;
}
