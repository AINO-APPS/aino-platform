/** Sprint effort belongs to the Story/Task/Bug level, not its breakdown. */
export interface PointTicket {
    is_subtask?: boolean;
    is_epic?: boolean;
}

export function countsForSprint(ticket: PointTicket): boolean {
    return !ticket.is_subtask && !ticket.is_epic;
}

export const SPRINT_POINT_TICKET_SQL = `NOT EXISTS (
    SELECT 1 FROM work_item_types point_type WHERE point_type.id = t.work_item_type_id
    AND (point_type.is_subtask = TRUE OR point_type.is_epic = TRUE)
)`;
