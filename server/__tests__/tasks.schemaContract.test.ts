/**
 * Schema contract for the Tasks SQL.
 *
 * The tenant schema is built by `initTenantSchema`, and every task query is
 * hand-written SQL. Nothing in the type system connects the two, so a query
 * can reference a column the schema never creates and only fail at runtime —
 * as a 500 on the endpoint that runs it.
 *
 * This test records the real DDL, derives the resulting table/column set, and
 * then runs the task queries against a db stub that rejects any reference to a
 * column the schema does not have. A query that would 500 in production fails
 * here instead.
 */
export {};

jest.mock("../utils/logger", () => ({
    logger: {
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn(), debug: jest.fn(),
        child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    },
}));

type Schema = Map<string, Set<string>>;

/** Record every DDL statement the tenant schema issues. */
async function recordTenantDdl(): Promise<string[]> {
    const statements: string[] = [];
    const { initTenantSchema } = require("../platform/db/tenantSchema");
    await initTenantSchema(async (sql: string) => {
        statements.push(sql);
        return { rows: [], rowCount: 0 };
    });
    return statements;
}

function normalise(sql: string): string {
    return sql.replace(/\s+/g, " ").trim();
}

/** Build the table → columns map the DDL produces. */
function buildSchema(statements: string[]): Schema {
    const schema: Schema = new Map();

    const addColumn = (table: string, column: string) => {
        const key = table.toLowerCase();
        if (!schema.has(key)) schema.set(key, new Set());
        schema.get(key)!.add(column.toLowerCase());
    };

    for (const raw of statements) {
        const sql = normalise(raw);

        // CREATE TABLE [IF NOT EXISTS] name ( col TYPE, ... )
        const create = sql.match(/^CREATE TABLE (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)\s*\(([\s\S]*)\)$/i);
        if (create) {
            const table = create[1];
            const body = create[2];
            // Split on top-level commas only: type expressions such as
            // NUMERIC(6,2) and CHECK(...) contain their own commas.
            let depth = 0;
            let current = "";
            const parts: string[] = [];
            for (const ch of body) {
                if (ch === "(") depth++;
                if (ch === ")") depth--;
                if (ch === "," && depth === 0) {
                    parts.push(current);
                    current = "";
                    continue;
                }
                current += ch;
            }
            parts.push(current);

            for (const part of parts) {
                const trimmed = part.trim();
                if (!trimmed) continue;
                if (/^(PRIMARY|UNIQUE|FOREIGN|CONSTRAINT|CHECK)\b/i.test(trimmed)) continue;
                const column = trimmed.match(/^([a-z_][a-z0-9_]*)/i);
                if (column) addColumn(table, column[1]);
            }
            continue;
        }

        // ALTER TABLE name ADD COLUMN [IF NOT EXISTS] col TYPE
        const add = sql.match(/^ALTER TABLE ([a-z_][a-z0-9_]*) ADD COLUMN (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)/i);
        if (add) {
            addColumn(add[1], add[2]);
            continue;
        }

        // ALTER TABLE name DROP COLUMN [IF EXISTS] col
        const drop = sql.match(/^ALTER TABLE ([a-z_][a-z0-9_]*) DROP COLUMN (?:IF EXISTS )?([a-z_][a-z0-9_]*)/i);
        if (drop) {
            schema.get(drop[1].toLowerCase())?.delete(drop[2].toLowerCase());
        }
    }

    return schema;
}

/** Resolve `alias.column` references against the schema. */
function unknownColumns(sql: string, schema: Schema): string[] {
    const text = normalise(sql);
    const aliases = new Map<string, string>();

    // FROM / JOIN <table> [AS] <alias>
    const tableRef = /\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)(?:\s+(?:AS\s+)?([a-z_][a-z0-9_]*))?/gi;
    let ref;
    while ((ref = tableRef.exec(text)) !== null) {
        const table = ref[1].toLowerCase();
        const alias = (ref[2] || ref[1]).toLowerCase();
        if (["where", "on", "left", "join", "inner", "group", "order", "limit", "set"].includes(alias)) {
            aliases.set(table, table);
            continue;
        }
        aliases.set(alias, table);
    }

    const unknown: string[] = [];
    const qualified = /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi;
    let match;
    while ((match = qualified.exec(text)) !== null) {
        const alias = match[1].toLowerCase();
        const column = match[2].toLowerCase();
        const table = aliases.get(alias);
        if (!table) continue;
        const columns = schema.get(table);
        if (!columns) continue;
        if (!columns.has(column)) unknown.push(`${alias}.${column} (table ${table})`);
    }

    return [...new Set(unknown)];
}

/** A db stub that records the SQL and rejects unknown columns. */
function schemaCheckedDb(schema: Schema, rows: any[] = []) {
    const queries: string[] = [];
    return {
        queries,
        query: async (sql: string) => {
            queries.push(normalise(sql));
            const unknown = unknownColumns(sql, schema);
            if (unknown.length) {
                throw new Error(`column does not exist: ${unknown.join(", ")}`);
            }
            return { rows, rowCount: rows.length };
        },
    };
}

describe("task SQL matches the tenant schema", () => {
    let schema: Schema;

    beforeAll(async () => {
        schema = buildSchema(await recordTenantDdl());
    });

    test("the recorded schema has the tables the task queries read", () => {
        for (const table of ["tasks", "work_item_types", "leaves", "holidays", "calendar_events", "projects"]) {
            expect(schema.has(table)).toBe(true);
        }
    });

    test("GET /api/tasks/epics queries only columns that exist", async () => {
        const { findEpics, findEpicRollups } = require("../modules/tasks/tasks.repository");
        const db = schemaCheckedDb(schema, [{ id: 1, parent_task_id: 1 }]);

        await expect(findEpics(db, 1)).resolves.toBeDefined();
        await expect(findEpicRollups(db, 1, [1])).resolves.toBeDefined();
    });

    test("GET /api/tasks/schedule-overlays queries only columns that exist", async () => {
        const { findScheduleOverlays } = require("../modules/tasks/tasks.schedule");
        const db = schemaCheckedDb(schema);

        await expect(findScheduleOverlays(db, "2026-09-25", "2026-11-24")).resolves.toBeDefined();
    });
});
