/**
 * Calendar overlays.
 *
 * Approved leave, holidays and booked meetings render as read-only background
 * context behind tasks. Each type toggles independently, and none of them
 * affects task counts or point totals.
 */

export type OverlayType = "leave" | "holidays" | "meetings";

export interface OverlayVisibility {
    leave: boolean;
    holidays: boolean;
    meetings: boolean;
}

export const DEFAULT_OVERLAYS: OverlayVisibility = {
    leave: true,
    holidays: true,
    meetings: false,
};

export interface OverlayItem {
    id: number | string;
    type: OverlayType;
    date: string;
    endDate?: string | null;
    label: string;
}

function eachDay(from: string, to: string): string[] {
    const days: string[] = [];
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    for (let cursor = start; cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
        const year = cursor.getFullYear();
        const month = String(cursor.getMonth() + 1).padStart(2, "0");
        const day = String(cursor.getDate()).padStart(2, "0");
        days.push(`${year}-${month}-${day}`);
    }
    return days;
}

/** Flatten the server payload into one item per day, per type. */
export function overlayItems(payload: any): OverlayItem[] {
    const items: OverlayItem[] = [];

    for (const leave of payload?.leave ?? []) {
        const start = String(leave.date).slice(0, 10);
        const end = String(leave.end_date ?? leave.date).slice(0, 10);
        for (const date of eachDay(start, end)) {
            items.push({
                id: `leave-${leave.id}-${date}`,
                type: "leave",
                date,
                label: `${leave.user_name ?? "Someone"} on ${leave.leave_type ?? "leave"}`,
            });
        }
    }

    for (const holiday of payload?.holidays ?? []) {
        items.push({
            id: `holiday-${holiday.id}`,
            type: "holidays",
            date: String(holiday.date).slice(0, 10),
            label: holiday.name ?? "Holiday",
        });
    }

    for (const meeting of payload?.meetings ?? []) {
        items.push({
            id: `meeting-${meeting.id}`,
            type: "meetings",
            date: String(meeting.start_time).slice(0, 10),
            label: meeting.title ?? "Meeting",
        });
    }

    return items;
}

/** The overlays visible for a day, honouring the independent toggles. */
export function overlaysForDay(
    items: OverlayItem[],
    date: string,
    visibility: OverlayVisibility,
): OverlayItem[] {
    return items.filter((item) => item.date === date && visibility[item.type]);
}

/** Toggle one overlay type without touching the others. */
export function toggleOverlay(
    visibility: OverlayVisibility,
    type: OverlayType,
): OverlayVisibility {
    return { ...visibility, [type]: !visibility[type] };
}

/** A day with an all-day absence still renders; it is never hidden. */
export function hasAllDayAbsence(items: OverlayItem[], date: string): boolean {
    return items.some(
        (item) => item.date === date && (item.type === "leave" || item.type === "holidays"),
    );
}
