export {};

const {
    extractIssueKeys,
    formatIssueKey,
    isValidProjectKey,
    parseIssueKey,
    resolveIssueKey,
} = require("../routes/tasks/_helpers/issueKey");

describe("issueKey helpers", () => {
    describe("isValidProjectKey", () => {
        test("accepts a 2–10 character project key", () => {
            expect(isValidProjectKey("WP_CORE")).toBe(true);
            expect(isValidProjectKey("A1")).toBe(true);
        });

        test("rejects keys outside the database constraint", () => {
            for (const key of ["", "A", "1A", "A-B", "a1", "A".repeat(11)]) {
                expect(isValidProjectKey(key)).toBe(false);
            }
        });
    });

    describe("formatIssueKey", () => {
        test("formats key + number into PROJ-N", () => {
            expect(formatIssueKey("PSSPMT", 123)).toBe("PSSPMT-123");
        });
        test("upper-cases project key", () => {
            expect(formatIssueKey("proj", 1)).toBe("PROJ-1");
        });
        test("returns null on missing parts", () => {
            expect(formatIssueKey(null, 1)).toBeNull();
            expect(formatIssueKey("X", null)).toBeNull();
            expect(formatIssueKey("", 1)).toBeNull();
            expect(formatIssueKey("X", 1)).toBeNull();
            expect(formatIssueKey("PROJ", 0)).toBeNull();
            expect(formatIssueKey("PROJ", -1)).toBeNull();
        });
    });

    describe("parseIssueKey", () => {
        test("parses a complete ticket key case-insensitively", () => {
            expect(parseIssueKey("wp_core-42")).toEqual({
                projectKey: "WP_CORE",
                taskNumber: 42,
                raw: "WP_CORE-42",
            });
        });

        describe("resolveIssueKey", () => {
            test("returns the task and marks whether its requested key is an alias", async () => {
                const db = {
                    query: jest.fn()
                        .mockResolvedValueOnce({ rows: [{ id: 8, ticket_key: "PROJ-8" }], rowCount: 1 })
                        .mockResolvedValueOnce({ rows: [{ id: 8, ticket_key: "PROJ-8" }], rowCount: 1 }),
                };

                const current = await resolveIssueKey("PROJ-8", 1, db);
                const former = await resolveIssueKey("OLD-8", 1, db);

                expect(current).toMatchObject({ task_id: 8, is_alias: false });
                expect(former).toMatchObject({ task_id: 8, is_alias: true });
            });
        });

        test("rejects text that is not exactly one valid key", () => {
            for (const key of ["X-1", "PROJ-0", "PROJ-1234567890", " PROJ-1", "PROJ-1 extra"]) {
                expect(parseIssueKey(key)).toBeNull();
            }
        });
    });

    describe("extractIssueKeys", () => {
        test("finds a single key in a branch name", () => {
            const out = extractIssueKeys("feature/PSSPMT-123-add-login");
            expect(out).toEqual([{ projectKey: "PSSPMT", taskNumber: 123, raw: "PSSPMT-123" }]);
        });
        test("finds multiple distinct keys and dedupes", () => {
            const out = extractIssueKeys("PROJ-1 and PROJ-2 and PROJ-1 again");
            expect(out).toHaveLength(2);
            expect(out.map((r: any) => r.raw).sort()).toEqual(["PROJ-1", "PROJ-2"]);
        });
        test("finds keys in commit messages with mixed case", () => {
            const out = extractIssueKeys("fix: addressed psspmt-9 review notes");
            expect(out).toEqual([{ projectKey: "PSSPMT", taskNumber: 9, raw: "PSSPMT-9" }]);
        });
        test("accepts lowercase prefixes via case-insensitive match", () => {
            // Our regex uses /i so a lowercase "fix-123" matches and is then
            // upper-cased to FIX-123.
            const out = extractIssueKeys("fix-123 in the readme");
            expect(out).toEqual([{ projectKey: "FIX", taskNumber: 123, raw: "FIX-123" }]);
        });
        test("returns [] on empty / null input", () => {
            expect(extractIssueKeys("")).toEqual([]);
            expect(extractIssueKeys(null)).toEqual([]);
            expect(extractIssueKeys(undefined)).toEqual([]);
        });
        test("does not match keys without the dash", () => {
            expect(extractIssueKeys("PROJ123")).toEqual([]);
        });
        test("does not match keys with single-letter prefixes", () => {
            // Project keys must be 2+ chars (regex: [A-Z][A-Z0-9_]{1,9})
            expect(extractIssueKeys("X-123")).toEqual([]);
        });

        // The regex is intentionally generic — *any* project key the user
        // creates (PSSPMT, WEB, CORE, MARKETING2024, …) is picked up
        // automatically. There's no hardcoded prefix anywhere in the code.
        test("matches an arbitrary user-defined project key", () => {
            // Project keys are 2–10 chars per the DB CHECK constraint
            // `^[A-Z][A-Z0-9_]{1,9}$`, so the regex tops out at 10.
            const samples = [
                { text: "feature/WEB-1-landing", key: "WEB", n: 1 },
                { text: "release/CORE-9999-merge", key: "CORE", n: 9999 },
                { text: "fixes WP_CORE-42 review", key: "WP_CORE", n: 42 },
                { text: "A1-7 spike", key: "A1", n: 7 },
                { text: "see MARKETING-7", key: "MARKETING", n: 7 },
            ];
            for (const s of samples) {
                const out = extractIssueKeys(s.text);
                expect(out.length).toBeGreaterThan(0);
                expect(out[0].raw).toBe(`${s.key}-${s.n}`);
            }
        });
    });
});