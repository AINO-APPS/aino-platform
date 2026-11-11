import type { SchemaQuery } from "../platform/db/schemaTypes";

/** Configuration as it existed before project workflows and Subtask expansion. */
export async function seedLegacyAgileFixture(query: SchemaQuery): Promise<void> {
    await query("INSERT INTO org_agile_settings (org_id) SELECT id FROM organizations ON CONFLICT (org_id) DO NOTHING");
    await query(`INSERT INTO work_item_types (org_id, key, name, is_default, is_epic, sort_order)
        SELECT o.id, seed.key, seed.name, seed.is_default, seed.is_epic, seed.sort_order
        FROM organizations o CROSS JOIN (VALUES
            ('story', 'Story', TRUE, FALSE, 1),
            ('bug', 'Bug', FALSE, FALSE, 2),
            ('task', 'Task', FALSE, FALSE, 3),
            ('epic', 'Epic', FALSE, TRUE, 4)
        ) AS seed(key, name, is_default, is_epic, sort_order)
        ON CONFLICT DO NOTHING`);
    await query(`INSERT INTO workflow_states (org_id, key, name, category, is_initial, is_terminal, sort_order)
        SELECT o.id, seed.key, seed.name, seed.category, seed.is_initial, seed.is_terminal, seed.sort_order
        FROM organizations o CROSS JOIN (VALUES
            ('pending', 'New', 'open', TRUE, FALSE, 1),
            ('in_progress', 'In Progress', 'in_progress', FALSE, FALSE, 2),
            ('in_review', 'In Review', 'in_review', FALSE, FALSE, 3),
            ('done', 'Done', 'done', FALSE, TRUE, 4),
            ('cancelled', 'Cancelled', 'done', FALSE, TRUE, 5)
        ) AS seed(key, name, category, is_initial, is_terminal, sort_order)
        ON CONFLICT DO NOTHING`);
}
