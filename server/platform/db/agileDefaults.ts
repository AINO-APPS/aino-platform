import type { SchemaQuery } from "./schemaTypes";

/**
 * Seed default Agile config (work item types, workflow states, settings) for
 * every org in the tenant DB that doesn't yet have org_agile_settings.
 * Idempotent — safe to run on every boot.
 *
 * Also backfills tasks.workflow_state_id from the legacy tasks.status column
 * by matching the seeded workflow state keys.
 */
async function seedAgileDefaults(q: SchemaQuery): Promise<void> {
    const orgs = (await q(
        `SELECT o.id FROM organizations o
         LEFT JOIN org_agile_settings s ON s.org_id = o.id
         WHERE s.org_id IS NULL`
    )).rows;

    for (const { id: orgId } of orgs) {
        // 1. Settings row
        await q(
            `INSERT INTO org_agile_settings (org_id) VALUES ($1)
             ON CONFLICT (org_id) DO NOTHING`,
            [orgId]
        );

        // 2. Default work item types
        const defaultTypes = [
            { key: 'story', name: 'Story', icon: 'BookOpen', color: '#10b981', is_default: true, is_epic: false, sort_order: 1, description: 'A user-facing piece of value.' },
            { key: 'bug', name: 'Bug', icon: 'Bug', color: '#ef4444', is_default: false, is_epic: false, sort_order: 2, description: 'Something broken to fix.' },
            { key: 'task', name: 'Task', icon: 'Circle', color: '#6366f1', is_default: false, is_epic: false, sort_order: 3, description: 'Generic work item.' },
            { key: 'epic', name: 'Epic', icon: 'Target', color: '#8b5cf6', is_default: false, is_epic: true, sort_order: 4, description: 'A large body of work that groups stories.' },
        ];
        for (const t of defaultTypes) {
            await q(
                `INSERT INTO work_item_types (org_id, key, name, icon, color, description, is_default, is_epic, sort_order)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (org_id, key) DO NOTHING`,
                [orgId, t.key, t.name, t.icon, t.color, t.description, t.is_default, t.is_epic, t.sort_order]
            );
        }

        // 3. Default workflow states (one per category — matches legacy COLUMNS)
        const defaultStates = [
            { key: 'pending', name: 'To Do', category: 'open', color: '#6b7280', sort_order: 1, is_initial: true, is_terminal: false },
            { key: 'in_progress', name: 'In Progress', category: 'in_progress', color: '#f59e0b', sort_order: 2, is_initial: false, is_terminal: false },
            { key: 'in_review', name: 'In Review', category: 'in_review', color: '#3b82f6', sort_order: 3, is_initial: false, is_terminal: false },
            { key: 'done', name: 'Done', category: 'done', color: '#10b981', sort_order: 4, is_initial: false, is_terminal: true },
        ];
        for (const st of defaultStates) {
            await q(
                `INSERT INTO workflow_states (org_id, key, name, category, color, sort_order, is_initial, is_terminal)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (org_id, key) DO NOTHING`,
                [orgId, st.key, st.name, st.category, st.color, st.sort_order, st.is_initial, st.is_terminal]
            );
        }
    }

    // Backfill tasks.workflow_state_id from tasks.status (matching by key within the same org)
    await q(`
        UPDATE tasks t
           SET workflow_state_id = ws.id
          FROM workflow_states ws
         WHERE t.workflow_state_id IS NULL
           AND ws.org_id = t.org_id
           AND ws.key   = t.status
    `);

    // Backfill tasks.work_item_type_id with the default 'story' type for tasks that
    // don't have one yet, scoped to the same org.
    await q(`
        UPDATE tasks t
           SET work_item_type_id = wit.id
          FROM work_item_types wit
         WHERE t.work_item_type_id IS NULL
           AND wit.org_id = t.org_id
           AND wit.is_default = TRUE
    `);
}

export { seedAgileDefaults };
