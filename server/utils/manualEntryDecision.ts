/**
 * Applies an approve/reject decision on a `manual_entry` approval request to
 * the requester's time_entries, inside the caller's transaction. Used by the
 * single and bulk /manager/approvals routes so both behave identically.
 *
 * - Edit request (`metadata.edit === true`): existing entries were left intact
 *   while pending. Approval replaces the day with the proposed rows (approved);
 *   rejection leaves the day untouched.
 * - Plain manual entry: pending manual rows were inserted up front, so the
 *   decision just flips them to approved / rejected.
 *
 * Dates are resolved in the requester's timezone (the request's
 * `metadata.timezone_offset`, else the saved users.timezone_offset), never the
 * approver's.
 */
interface DbLike {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

interface ManualEntryApproval {
    requester_id: number;
    metadata?: string | null;
}

const VALID_WORK_MODES = ["office", "remote", "hybrid"];

export async function applyManualEntryDecision(
    client: DbLike,
    approval: ManualEntryApproval,
    actorId: number,
    decision: "approved" | "rejected",
): Promise<void> {
    let metadata: any = {};
    if (approval.metadata) { try { metadata = JSON.parse(approval.metadata); } catch { /* malformed metadata */ } }
    if (!metadata.date) return;
    const isEdit = metadata.edit === true;
    if (isEdit && (decision === "rejected" || !metadata.clock_in)) return;

    // Prefer the offset the request was submitted with; users.timezone_offset is
    // only refreshed on a real clock-in and may be stale or default to 0.
    let reqOffset: number;
    if (typeof metadata.timezone_offset === "number" && Number.isFinite(metadata.timezone_offset)) {
        reqOffset = metadata.timezone_offset;
    } else {
        const requesterRow = (await client.query("SELECT timezone_offset FROM users WHERE id = $1", [approval.requester_id])).rows[0];
        reqOffset = Number(requesterRow?.timezone_offset) || 0;
    }
    const tzMod = `${-reqOffset} minutes`;

    if (!isEdit) {
        await client.query(
            `UPDATE time_entries SET approval_status = $1, approved_by = $2 WHERE user_id = $3 AND (timestamp + $4::interval)::date = $5::date AND is_manual = TRUE`,
            [decision, actorId, approval.requester_id, tzMod, metadata.date],
        );
        return;
    }

    const toUtc = (time: string) => {
        const [y, m, d] = String(metadata.date).split("-").map(Number);
        const [hh, mm] = time.split(":").map(Number);
        return new Date(Date.UTC(y, m - 1, d, hh, mm, 0) + reqOffset * 60000).toISOString();
    };
    const workMode = VALID_WORK_MODES.includes(metadata.work_mode) ? metadata.work_mode : "office";
    await client.query(
        `DELETE FROM time_entries WHERE user_id = $1 AND (timestamp + $2::interval)::date = $3::date`,
        [approval.requester_id, tzMod, metadata.date],
    );
    const insert = (type: string, ts: string, mode: string | null) => client.query(
        "INSERT INTO time_entries (user_id, entry_type, timestamp, work_mode, is_manual, approval_status, approved_by) VALUES ($1,$2,$3,$4,TRUE,'approved',$5)",
        [approval.requester_id, type, ts, mode, actorId],
    );
    await insert("clock_in", toUtc(metadata.clock_in), workMode);
    if (Array.isArray(metadata.breaks)) {
        const sorted = metadata.breaks
            .filter((b: any) => b && b.start && b.end)
            .sort((a: any, b: any) => String(a.start).localeCompare(String(b.start)));
        for (const brk of sorted) {
            await insert("break_start", toUtc(brk.start), null);
            await insert("break_end", toUtc(brk.end), null);
        }
    }
    if (metadata.clock_out) await insert("clock_out", toUtc(metadata.clock_out), null);
}
