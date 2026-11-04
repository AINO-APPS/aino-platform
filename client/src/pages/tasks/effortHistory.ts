import { formatMinutes } from './time';

function metadata(value?: string | null): Record<string, any> | null {
    try {
        const parsed = JSON.parse(value ?? 'null');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
}
export function effortHistoryValue(value: string | null | undefined, estimates: boolean): string {
    const row = metadata(value);
    if (!row) return value || '—';
    const duration = (minutes: unknown) => minutes == null ? '—' : formatMinutes(minutes);
    if (estimates) return `Original ${duration(row.original_estimate_minutes)}, remaining ${duration(row.remaining_estimate_minutes)}`;
    const author = row.author?.full_name || row.author?.username || `author #${row.author_id ?? '?'}`;
    const loggedBy = row.logged_by?.full_name || row.logged_by?.username || `#${row.logged_by_id ?? '?'}`;
    return `#${row.id ?? '?'} · ${author} · logged by ${loggedBy} · ${row.day_worked ?? '—'} · ${duration(row.minutes)}`
        + (row.start_time ? ` · ${row.start_time}` : '') + (row.comment ? ` · ${row.comment}` : '');
}
