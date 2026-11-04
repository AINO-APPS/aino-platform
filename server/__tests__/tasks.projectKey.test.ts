import { changeProjectKey } from "../modules/tasks/tasks.projectKey";
import type { ProjectAccessRepositoryDb } from "../modules/tasks/tasks.projectAccessRepository";

test.each([true, false])("project key preview=%s scopes ticket counts, aliases and rewrites to the actor organization", async (preview) => {
    const query = jest.fn(async (sql: string, _params?: unknown[]) => {
        if (sql.includes("FOR UPDATE")) return { rows: [{ id: 21, key: "OLD", key_published: true }], rowCount: 1 };
        if (sql.includes("COUNT(*)")) return { rows: [{ count: 2 }], rowCount: 1 };
        return { rows: [], rowCount: 2 };
    });
    const db: ProjectAccessRepositoryDb = { query, transaction: async (run) => run(db) };
    await expect(changeProjectKey(db, { userId: 3, orgId: 7, orgRole: "super_admin" }, 21, "NEW", preview))
        .resolves.toMatchObject({ affected_tickets: 2 });

    const ticketAndProjectQueries = query.mock.calls.filter(([sql]) =>
        /FROM tasks|UPDATE tasks|UPDATE projects/.test(sql));
    expect(ticketAndProjectQueries).toHaveLength(preview ? 1 : 3);
    for (const [sql, params] of ticketAndProjectQueries) {
        const scope = sql.match(/\borg_id\s*=\s*\$(\d+)/);
        expect(scope).not.toBeNull();
        expect(params![Number(scope![1]) - 1]).toBe(7);
    }
});
