/** Accept paginated parent families and flat board reads without duplicating cards. */
export function planningFamilies(tickets: any[]): Array<{ task: any; subtasks: any[] }> {
    const ids = new Set(tickets.map(ticket => String(ticket.id)));
    const children = new Map<string, Map<string, any>>();
    for (const ticket of tickets) {
        for (const child of ticket.subtasks ?? []) {
            const key = String(ticket.id);
            if (!children.has(key)) children.set(key, new Map());
            children.get(key)!.set(String(child.id), child);
        }
        if (ticket.is_subtask && ticket.parent_task_id != null) {
            const key = String(ticket.parent_task_id);
            if (!children.has(key)) children.set(key, new Map());
            children.get(key)!.set(String(ticket.id), ticket);
        }
    }
    return tickets.filter(ticket => !ticket.is_subtask || !ids.has(String(ticket.parent_task_id)))
        .map(task => ({ task, subtasks: [...(children.get(String(task.id))?.values() ?? [])] }));
}

export function planningPoints(tickets: any[]): number {
    return tickets.filter(ticket => !ticket.is_subtask && !ticket.is_epic)
        .reduce((sum, ticket) => sum + (Number(ticket.story_points) || 0), 0);
}
