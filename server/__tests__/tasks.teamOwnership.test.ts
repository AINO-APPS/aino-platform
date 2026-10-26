export {};

/**
 * Every path that creates a ticket must set its owning team, and the backfill
 * migration must be idempotent.
 *
 * A mocked database accepts any SQL string, so these tests read the statements
 * themselves — the same approach as `tasks.createInsertArity.test.ts`, which
 * caught a real VALUES/column mismatch that unit mocks could not.
 */

const fs = require("fs");
const path = require("path");
import {
    canMoveIntoTeamSprint,
    resolveCreateTeamId,
    teamAfterSprintMove,
} from "../modules/tasks/tasks.ownership";
import type { TaskActor } from "../modules/tasks/tasks.policy";

const INSERTS = [
    { name: "POST /api/tasks", file: "routes/tasks/crud.ts" },
    { name: "POST /api/tasks/backlog", file: "routes/tasks/backlog.ts" },
    { name: "POST /api/tasks/carry-forward", file: "routes/tasks/carryForward.ts" },
    { name: "POST /api/notes/convert-to-task", file: "routes/notes.ts" },
    { name: "service-desk mirror", file: "modules/tasks/tasks.serviceDesk.ts" },
];

/** Split a comma list, ignoring commas inside nested parentheses. */
function splitTopLevel(input: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (const character of input) {
        if (character === "(") depth += 1;
        else if (character === ")") depth -= 1;
        if (character === "," && depth === 0) {
            parts.push(current.trim());
            current = "";
        } else {
            current += character;
        }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
}

/** Extract the INSERT INTO tasks column list and its VALUES list. */
function readInsert(file: string) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const start = source.indexOf("INSERT INTO tasks");
    expect(start).toBeGreaterThan(-1);
    const returningAt = source.indexOf("RETURNING", start);
    // Some inserts (notes, service desk) have no RETURNING clause; stop at the
    // end of the template string instead.
    const end = returningAt > -1 ? returningAt : source.indexOf("`", start);
    expect(end).toBeGreaterThan(-1);
    const sql = source.slice(start, end);

    const columnsOpen = sql.indexOf("(", sql.indexOf("tasks"));
    let depth = 0;
    let columnsClose = columnsOpen;
    for (let i = columnsOpen; i < sql.length; i += 1) {
        if (sql[i] === "(") depth += 1;
        if (sql[i] === ")") {
            depth -= 1;
            if (depth === 0) { columnsClose = i; break; }
        }
    }
    const columns = splitTopLevel(sql.slice(columnsOpen + 1, columnsClose));

    const valuesAt = sql.indexOf("VALUES");
    const valuesOpen = sql.indexOf("(", valuesAt);
    depth = 0;
    let valuesClose = valuesOpen;
    for (let i = valuesOpen; i < sql.length; i += 1) {
        if (sql[i] === "(") depth += 1;
        if (sql[i] === ")") {
            depth -= 1;
            if (depth === 0) { valuesClose = i; break; }
        }
    }
    const values = splitTopLevel(sql.slice(valuesOpen + 1, valuesClose));

    return { sql, columns, values };
}

describe.each(INSERTS)("$name sets an owning team", ({ file }) => {
    test("includes team_id in the column list", () => {
        const { columns } = readInsert(file);
        expect(columns).toContain("team_id");
    });

    test("supplies exactly one VALUES slot per column", () => {
        const { columns, values } = readInsert(file);
        expect(values).toHaveLength(columns.length);
    });

    test("numbers its placeholders contiguously from $1", () => {
        const { sql } = readInsert(file);
        const numbers = [...new Set(
            [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])),
        )].sort((a, b) => a - b);
        expect(numbers).toEqual(numbers.map((_, index) => index + 1));
    });
});

describe("resolveCreateTeamId", () => {
    const member: TaskActor = {
        userId: 1, orgId: 1, teamId: 10, role: "employee", teamVisibility: true,
    };
    const admin: TaskActor = { ...member, userId: 2, teamId: null, role: "hr_admin" };
    const db: any = {
        query: jest.fn(async (sql: string, params: unknown[] = []) => {
            if (/FROM teams WHERE id = \$1 AND org_id = \$2/.test(sql)) {
                return { rows: Number(params[0]) === 20 ? [{ id: 20 }] : [], rowCount: 0 };
            }
            return { rows: [], rowCount: 0 };
        }),
    };

    test("defaults to the creator's team", async () => {
        await expect(resolveCreateTeamId(db, { actor: member, orgId: 1 }))
            .resolves.toEqual({ teamId: 10 });
    });

    test("the sprint's team wins over the creator's team", async () => {
        await expect(resolveCreateTeamId(db, {
            actor: admin, orgId: 1, sprint: { id: 5, team_id: 20 },
        })).resolves.toEqual({ teamId: 20 });
    });

    test("an explicit team is honoured for admins only", async () => {
        await expect(resolveCreateTeamId(db, {
            actor: admin, orgId: 1, explicitTeamId: 20,
        })).resolves.toEqual({ teamId: 20 });

        const refused = await resolveCreateTeamId(db, {
            actor: member, orgId: 1, explicitTeamId: 20,
        });
        expect(refused.error?.status).toBe(403);
        // Even their own team id is not a non-admin choice.
        const ownTeam = await resolveCreateTeamId(db, {
            actor: member, orgId: 1, explicitTeamId: 10,
        });
        expect(ownTeam.error?.status).toBe(403);
    });

    test("a sprint that contradicts the chosen team is rejected", async () => {
        const result = await resolveCreateTeamId(db, {
            actor: admin, orgId: 1, explicitTeamId: 20, sprint: { id: 5, team_id: 30 },
        });
        expect(result.error?.status).toBe(409);
        expect(result.error?.body.code).toBe("SPRINT_TEAM_MISMATCH");
    });

    test("a legacy ticket adopts the sprint's team", async () => {
        await expect(resolveCreateTeamId(db, {
            actor: { ...member, teamId: null }, orgId: 1, sprint: { id: 5, team_id: 20 },
        })).resolves.toEqual({ teamId: 20 });
    });

    test("sprint same-team rule", () => {
        expect(canMoveIntoTeamSprint(10, 10)).toBe(true);
        expect(canMoveIntoTeamSprint(10, 20)).toBe(false);
        expect(canMoveIntoTeamSprint(null, 20)).toBe(true);
        expect(canMoveIntoTeamSprint(10, null)).toBe(false);
        expect(teamAfterSprintMove(null, 20)).toBe(20);
        expect(teamAfterSprintMove(10, 20)).toBe(10);
    });
});

describe("0016_tasks_team_ownership.sql", () => {
    const file = path.join(
        __dirname, "..", "platform", "db", "migrations", "0016_tasks_team_ownership.sql",
    );
    const sql = fs.readFileSync(file, "utf8");
    const normalised = sql.replace(/\s+/g, " ");

    test("backfills only rows that have no team and never blocks on NULL", () => {
        expect(normalised).toContain("WHERE t.team_id IS NULL");
        expect(normalised).toContain("AND resolved.resolved_team_id IS NOT NULL");
        expect(normalised).not.toMatch(/ALTER COLUMN team_id SET NOT NULL/);
    });

    test("resolves sprint team first, then creator, then assignee", () => {
        expect(normalised).toContain(
            "COALESCE(s.team_id, creator.team_id, assignee.team_id)",
        );
    });

    test("records and logs sprint/creator team conflicts", () => {
        expect(normalised).toContain("task_team_backfill_conflicts");
        expect(normalised).toContain("s.team_id IS DISTINCT FROM creator.team_id");
        expect(normalised).toContain("RAISE NOTICE");
    });

    test("is safe to re-run", () => {
        expect(normalised).toContain("CREATE TABLE IF NOT EXISTS task_team_backfill_conflicts");
        expect(normalised).toContain("ON CONFLICT (task_id) DO NOTHING");
        expect(normalised).toContain("ADD COLUMN IF NOT EXISTS team_id");
    });
});
