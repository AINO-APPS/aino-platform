export {};

/**
 * DATE columns must reach the API as plain `YYYY-MM-DD` strings.
 *
 * `tasks.due_date`, `tasks.planned_date` and `sprint_burndown_snapshots.snapshot_date`
 * are all PostgreSQL `DATE`. node-postgres parses `DATE` into a JS `Date` at local
 * midnight, so `JSON.stringify` emits a UTC instant (`2026-11-07T18:30:00.000Z` for
 * a 2026-11-08 due date at +05:30). Every client then either renders the wrong day
 * or fails to parse it at all — the "invalid due date" bug.
 *
 * The contract is a string, so this asserts the parser the whole server shares.
 */

jest.mock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn(), debug: jest.fn() },
}));

const { installPgTypeParsers } = require("../platform/db/pgTypes");

const DATE_OID = 1082;

describe("PostgreSQL DATE handling", () => {
    beforeAll(() => {
        // The same call `platform/db/pool.ts` makes at import time, so this
        // exercises the production registration rather than a test-only stub.
        installPgTypeParsers();
    });

    test("DATE values are parsed as YYYY-MM-DD strings, not Date objects", () => {
        const types = require("pg").types;
        const parse = types.getTypeParser(DATE_OID, "text");

        expect(parse("2026-11-08")).toBe("2026-11-08");
        expect(parse("2026-01-01")).toBe("2026-01-01");
    });

    test("a task row serialises due_date and planned_date as plain dates", () => {
        const types = require("pg").types;
        const parseDate = types.getTypeParser(DATE_OID, "text");

        const row = {
            id: 1,
            due_date: parseDate("2026-11-08"),
            planned_date: parseDate("2026-10-26"),
        };

        expect(JSON.parse(JSON.stringify(row))).toEqual({
            id: 1,
            due_date: "2026-11-08",
            planned_date: "2026-10-26",
        });
    });

    test("the client can parse the serialised due date", () => {
        const types = require("pg").types;
        const serialised = JSON.parse(
            JSON.stringify({ due_date: types.getTypeParser(DATE_OID, "text")("2026-11-08") }),
        ).due_date;

        // Mirrors client/src/pages/tasks/utils.tsx `parseLocalDate`.
        const parsed = new Date(`${serialised}T00:00:00`);
        expect(Number.isNaN(parsed.getTime())).toBe(false);
        expect(parsed.getFullYear()).toBe(2026);
        expect(parsed.getMonth()).toBe(10);
        expect(parsed.getDate()).toBe(8);
    });
});
