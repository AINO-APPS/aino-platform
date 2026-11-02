import { completeSprint } from "../services/sprintCompletion";

describe("sprint completion locking protocol", () => {
    test("takes the org gate and task locks before claiming the sprint row", async () => {
        const statements: Array<{ sql: string; params: unknown[] }> = [];
        const query = jest.fn(async (sql: string, params: unknown[] = []) => {
            statements.push({ sql, params });
            if (sql.includes("UPDATE sprints s") && sql.includes("SET completed_at")) {
                return { rows: [{ id: 10, team_id: 1 }], rowCount: 1 };
            }
            if (sql.includes("SELECT tm.org_id")) {
                return { rows: [{ org_id: 7, actor_id: 1 }], rowCount: 1 };
            }
            if (sql.includes("AS velocity")) {
                return { rows: [{ velocity: 0, done_tasks: 0, total_tasks: 0 }], rowCount: 1 };
            }
            if (sql.includes("SET status = 'completed'")) {
                return { rows: [{ id: 10, status: "completed" }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        });
        const db = {
            query,
            transaction: async <T>(callback: (client: any, ctx: any) => Promise<T>): Promise<T> =>
                callback({ query }, { afterCommit: () => undefined }),
        };

        const result = await completeSprint(db, {
            sprintId: 10,
            targetSprintId: null,
            actor: { userId: 1, orgId: 7 },
            effects: { changed: jest.fn() },
        });

        const gateIndex = statements.findIndex(({ sql }) => sql.includes("pg_advisory_xact_lock"));
        const memberLockIndex = statements.findIndex(({ sql }) => sql.includes("FOR UPDATE OF t"));
        const claimIndex = statements.findIndex(({ sql }) => sql.includes("completed_at"));
        const finishIndex = statements.findIndex(({ sql }) => sql.includes("SET status = 'completed'"));
        expect(result).not.toBeNull();
        expect(gateIndex).toBeGreaterThanOrEqual(0);
        expect(gateIndex).toBeLessThan(memberLockIndex);
        expect(memberLockIndex).toBeLessThan(claimIndex);
        expect(claimIndex).toBeLessThan(finishIndex);
        expect(statements[gateIndex].params).toContain("aino:ticket-placement:7");
    });
});
