/**
 * PostgreSQL type parsers shared by every pool in the process.
 *
 * `DATE` (OID 1082) is a calendar day with no time and no zone. node-postgres
 * parses it into a JS `Date` at *local* midnight, so `JSON.stringify` emits a
 * UTC instant — a 2026-11-08 due date becomes `2026-11-07T18:30:00.000Z` at
 * +05:30. Clients then render the previous day, or fail to parse it at all
 * (`new Date("2026-11-07T18:30:00.000Z" + "T00:00:00")` is Invalid Date).
 *
 * Every DATE column in the schema is a calendar day the API contract exposes
 * as `YYYY-MM-DD` (`tasks.due_date`, `tasks.planned_date`,
 * `sprint_burndown_snapshots.snapshot_date`), so the parser returns the raw
 * string. `TIMESTAMPTZ` is untouched and still arrives as a `Date`.
 */
import { types } from "pg";

const DATE_OID = 1082;

/** The raw `YYYY-MM-DD` text PostgreSQL sends for a DATE. */
export function parseDateOnly(value: string): string {
    return value;
}

let installed = false;

/**
 * Register the DATE parser. Idempotent, so importing this from more than one
 * entry point cannot stack parsers.
 */
export function installPgTypeParsers(): void {
    if (installed) return;
    types.setTypeParser(DATE_OID, parseDateOnly);
    installed = true;
}
