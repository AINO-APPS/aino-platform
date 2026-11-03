import type { TasksDb } from './tasks.types';

export async function writeEstimates(db: TasksDb, taskId: number, original: number | null, remaining: number | null) {
    await db.query('UPDATE tasks SET original_estimate_minutes=$2, remaining_estimate_minutes=$3 WHERE id=$1', [taskId, original, remaining]);
}
export async function writeRemaining(db: TasksDb, taskId: number, remaining: number | null) {
    await db.query('UPDATE tasks SET remaining_estimate_minutes=$2 WHERE id=$1', [taskId, remaining]);
}
export async function recordEstimateChange(db: TasksDb, taskId: number, actorId: number, orgId: number | null,
    before: unknown, after: unknown, ip?: string, userAgent?: string) {
    await db.query(`INSERT INTO task_history (task_id,user_id,action,field,old_value,new_value)
        VALUES ($1,$2,'estimate_changed','estimates',$3,$4)`, [taskId,actorId,JSON.stringify(before),JSON.stringify(after)]);
    await db.query(`INSERT INTO audit_logs (org_id,actor_id,action,entity_type,entity_id,details,ip_address,user_agent)
        VALUES ($1,$2,'estimate_changed','task',$3,$4,$5,$6)`, [orgId,actorId,taskId,JSON.stringify({before,after}),ip??null,userAgent??null]);
}
