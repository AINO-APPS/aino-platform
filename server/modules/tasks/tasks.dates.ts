import type { TasksDb } from "./tasks.types";
import { lockTicketDates, saveStartDate, recordDateHistory } from "./tasks.dateRepository";
export { lockTicketDates, recordDateHistory };

export const DUE_BEFORE_START = "Due date cannot be earlier than the start date";

export function requestedStartDate(body: Record<string, unknown>, fallback?: unknown): unknown {
    if (body.start_date !== undefined) return body.start_date;
    return fallback;
}

function day(value: unknown): string | null | undefined {
    if (value == null || value === "") return null;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? undefined : value;
}

export function resolveTicketDates(current: { start_date?: unknown; due_date?: unknown }, body: Record<string, unknown>) {
    const requested = requestedStartDate(body);
    const startDate = day(requested === undefined ? current.start_date : requested);
    const dueDate = day(body.due_date === undefined ? current.due_date : body.due_date);
    const error = startDate === undefined || dueDate === undefined
        ? "Valid date in YYYY-MM-DD format is required"
        : startDate && dueDate && dueDate < startDate ? DUE_BEFORE_START : null;
    return { startDate: startDate ?? null, dueDate: dueDate ?? null, error };
}

export class TicketDateError extends Error { readonly dateError = true; }

/** Called inside the request transaction so validation sees the locked dates. */
export async function editTicketStartDate(db: TasksDb, id: number, date: unknown, userId: number) {
    const current = await lockTicketDates(db, id);
    const dates = resolveTicketDates(current, { start_date: date });
    if (dates.error) throw new TicketDateError(dates.error);
    return setTicketStartDate(db, current, dates.startDate, userId);
}

/** Date fields and their history are committed together, never through placement. */
export async function setTicketStartDate(db: TasksDb, task: any, startDate: string | null, userId: number) {
    const updated = await saveStartDate(db, task.id, startDate);
    if ((task.start_date ?? null) !== startDate) {
        await recordDateHistory(db, task.id, userId, "start_date", task.start_date, startDate);
    }
    return updated;
}
