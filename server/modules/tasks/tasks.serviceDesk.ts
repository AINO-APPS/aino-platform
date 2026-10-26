/**
 * Create the backlog task that mirrors a service-desk ticket.
 *
 * The task starts in the org's initial workflow state, which is the only
 * status the schema has (D4), and has no planner day until someone schedules
 * it (D2).
 */

export interface ServiceDeskTaskDb {
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }>;
}

export interface ServiceDeskTaskInput {
    creatorId: number;
    orgId: number | null;
    title: string;
    description: string;
    priority: string;
    ticketId: number;
}

export async function createServiceDeskBacklogTask(
    db: ServiceDeskTaskDb,
    input: ServiceDeskTaskInput,
): Promise<void> {
    // The mirrored ticket belongs to the creator's team, so the team that
    // triages the service desk sees it without the creator's help.
    const creator = (await db.query("SELECT team_id FROM users WHERE id = $1", [input.creatorId])).rows[0];
    await db.query(
        `INSERT INTO tasks (user_id, planned_date, title, description, priority, org_id, team_id,
                           workflow_state_id, service_desk_ticket_id)
         VALUES ($1, NULL, $2, $3, $4, $5, $6,
                 (SELECT id FROM workflow_states
                   WHERE org_id = $5 AND is_active = TRUE
                   ORDER BY is_initial DESC, sort_order ASC, id ASC LIMIT 1),
                 $7)`,
        [input.creatorId, input.title, input.description, input.priority, input.orgId,
            creator?.team_id ?? null, input.ticketId],
    );
}
