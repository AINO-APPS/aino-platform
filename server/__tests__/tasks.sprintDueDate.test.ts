/**
 * Joining a sprint adopts the sprint's end date as the due date. Leaving the
 * sprint must give the ticket back its own date: a dated ticket returns to
 * Scheduled, an undated one to the Backlog — not to Scheduled at the old
 * sprint's end date.
 */
import { clearSprint, setSprintAndDueDate } from "../modules/tasks/tasks.sprintRepository";

function recordingDb() {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    return {
        calls,
        query: jest.fn(async (sql: string, params: unknown[] = []) => {
            calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
            return { rows: [], rowCount: 1 };
        }),
    };
}

describe("sprint due date round trip", () => {
    test("joining a sprint remembers the ticket's own due date, once", async () => {
        const db = recordingDb();
        await setSprintAndDueDate(db, 5, 9, "2026-11-08");
        const { sql, params } = db.calls[0];
        expect(sql).toContain("pre_sprint_due_date = CASE WHEN sprint_id IS NULL THEN due_date ELSE pre_sprint_due_date END");
        expect(sql).toContain("due_date = $2");
        expect(params).toEqual([9, "2026-11-08", 5]);
    });

    test("leaving a sprint restores the remembered due date", async () => {
        const db = recordingDb();
        await clearSprint(db, 5);
        const { sql } = db.calls[0];
        expect(sql).toContain("sprint_id = NULL");
        expect(sql).toContain("due_date = pre_sprint_due_date");
        expect(sql).toContain("pre_sprint_due_date = NULL");
    });
});
