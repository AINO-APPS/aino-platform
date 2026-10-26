export {};

/**
 * A ticket must be creatable.
 *
 * The INSERT in both create routes listed 19 columns but supplied 20 VALUES
 * slots: the legacy `status` column was dropped from the column list (ticket
 * 28) while its `$n` placeholder stayed behind. PostgreSQL rejects that with
 * "INSERT has more expressions than target columns", so every create returned
 * 500 and no ticket could be added from the backlog or the planner.
 *
 * A mocked database cannot catch this — it accepts any SQL string — so this
 * test asserts the statement's own shape: one VALUES slot per column, and the
 * placeholders numbered contiguously from $1.
 */

const fs = require("fs");
const path = require("path");

const ROUTES = [
    { name: "POST /api/tasks/backlog", file: "routes/tasks/backlog.ts" },
    { name: "POST /api/tasks", file: "routes/tasks/crud.ts" },
];

/** The INSERT INTO tasks statement and its VALUES slots. */
function readInsert(file: string) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const start = source.indexOf("INSERT INTO tasks");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("RETURNING id", start);
    expect(end).toBeGreaterThan(-1);
    const sql = source.slice(start, end);

    const columnsPart = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")"));
    const columns = columnsPart.split(",").map((s: string) => s.trim()).filter(Boolean);

    const valuesPart = sql.slice(sql.indexOf("VALUES") + "VALUES".length, sql.lastIndexOf(")"));
    const values = valuesPart.split(",").map((s: string) => s.trim()).filter(Boolean);

    return { sql, columns, values };
}

describe.each(ROUTES)("$name INSERT shape", ({ file }) => {
    test("supplies exactly one VALUES slot per column", () => {
        const { columns, values } = readInsert(file);
        expect(values).toHaveLength(columns.length);
    });

    test("numbers its placeholders contiguously from $1", () => {
        const { sql } = readInsert(file);
        const numbers = [...new Set(
            [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])),
        )].sort((a, b) => a - b);
        expect(numbers).toEqual(numbers.map((_, index) => index + 1));
    });

    test("does not reference the dropped legacy status column", () => {
        const { columns } = readInsert(file);
        expect(columns).not.toContain("status");
    });
});
