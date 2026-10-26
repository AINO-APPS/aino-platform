/**
 * A due date that arrives from the API renders as the right day.
 *
 * The server sends DATE columns as `YYYY-MM-DD` (see
 * `server/platform/db/pgTypes.ts`). This pins the client half of that contract:
 * the card must show the day the ticket is actually due, and must not call it
 * overdue when it is not.
 */
import { describe, expect, test } from "vitest";
import { formatDueDate, isDueOverdue, parseLocalDate } from "../utils";

describe("due dates from the API", () => {
    test("a plain YYYY-MM-DD parses to that calendar day", () => {
        const parsed = parseLocalDate("2026-11-08");
        expect(parsed.getFullYear()).toBe(2026);
        expect(parsed.getMonth()).toBe(10);
        expect(parsed.getDate()).toBe(8);
    });

    test("a far-future due date is not overdue", () => {
        expect(isDueOverdue("2099-11-08")).toBe(false);
    });

    test("a past due date is overdue", () => {
        expect(isDueOverdue("2020-01-01")).toBe(true);
    });

    test("a due date renders as a readable label, never Invalid Date", () => {
        const label = formatDueDate("2099-11-08");
        expect(label).toBeTruthy();
        expect(label).not.toMatch(/Invalid/);
    });

    test("a UTC instant is not a valid due date", () => {
        // The old server serialisation. If this ever comes back, the label is
        // wrong or unparseable — which is exactly the bug this guards.
        const utcInstant = "2026-11-07T18:30:00.000Z";
        expect(Number.isNaN(parseLocalDate(utcInstant).getTime())).toBe(true);
    });
});
