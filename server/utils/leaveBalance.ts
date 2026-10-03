/**
 * Update a user's leave balance (add or subtract used days) for the year of
 * `date`. Shared by /leaves and /manager/approvals decisions. `client` must be
 * a transaction connection so the balance update stays atomic.
 */
export async function updateLeaveBalance(userId: number, leaveType: string, date: string, duration: string, operation: "add" | "subtract", client: any) {
    if (!client) throw new Error("updateLeaveBalance must be called within a transaction (client is required)");
    const q = client.query.bind(client);
    const year = parseInt(date.slice(0, 4));
    const durationValue = duration === "half" ? 0.5 : duration === "quarter" ? 0.25 : 1;
    const balRes = await q(
        "SELECT id, used FROM leave_balances WHERE user_id = $1 AND leave_type = $2 AND year = $3 FOR UPDATE",
        [userId, leaveType, year]
    );
    let balance = balRes.rows[0];
    if (!balance) {
        // Auto-create a balance row with quota 0 so approvals don't fail
        // when no policy has been provisioned yet
        const ins = await q(
            "INSERT INTO leave_balances (user_id, leave_type, year, quota, used, carried_forward) VALUES ($1, $2, $3, 0, 0, 0) RETURNING id, used",
            [userId, leaveType, year]
        );
        balance = ins.rows[0];
    }
    // pg returns NUMERIC as a string — coerce so we don't accidentally do
    // string concatenation when adding the duration (e.g. '0' + 1 = '01').
    const currentUsed = Number(balance.used) || 0;
    const newUsed = operation === "add"
        ? currentUsed + durationValue
        : Math.max(0, currentUsed - durationValue);
    await q("UPDATE leave_balances SET used = $1 WHERE id = $2", [newUsed, balance.id]);
}
