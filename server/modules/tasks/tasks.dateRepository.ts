import type { TasksDb } from "./tasks.types";

export async function lockTicketDates(db: TasksDb, id: number) {
    return (await db.query("SELECT * FROM tasks WHERE id = $1 FOR UPDATE", [id])).rows[0];
}

export async function saveStartDate(db: TasksDb, id: number, date: string | null) {
    return (await db.query("UPDATE tasks SET start_date = $1 WHERE id = $2 RETURNING *", [date, id])).rows[0];
}

export async function recordDateHistory(db: TasksDb, id: number, userId: number, field: string, before: unknown, after: unknown) {
    await db.query(`INSERT INTO task_history (task_id, user_id, action, field, old_value, new_value)
        VALUES ($1, $2, 'updated', $3, $4, $5)`, [id, userId, field, before ?? null, after ?? null]);
}
