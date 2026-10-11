import { describe, expect, test } from "vitest";
import { cleanPollDraft, normalizePoll, pollCreationError, pollResults, samePollId } from "./pollHelpers";
import type { ChatPoll } from "../../api/chat";

const voter = (userId: number | string, fullName: string) => ({ userId, fullName, avatar: null });
const poll = (votes: ChatPoll["votes"]): ChatPoll => ({ id: 1, question: "Lunch?", options: ["A", "B", "C"], votes });

describe("poll parity helpers", () => {
    test("normalizes numeric/string IDs, missing names/avatars and old ID-only fixtures", () => {
        expect(samePollId(12, "12")).toBe(true);
        expect(samePollId(undefined, undefined)).toBe(false);
        expect(normalizePoll(poll({ 0: [voter(12, " Alice Smith "), 13 as never, null as never] })).votes[0])
            .toEqual([voter("12", "Alice Smith"), voter("13", "Member")]);
        expect(() => normalizePoll({ options: null } as never)).toThrow("Invalid poll response");
    });
    test("shares count selections separately from unique people, You first using real-name sorting", () => {
        const results = pollResults(normalizePoll(poll({
            0: [voter(2, "Zoe"), voter("1", "Bob"), voter(3, "Amy")], 1: [voter(2, "Zoe")],
        })), 1);
        expect(results.total).toBe(4);
        expect(results.people).toBe(3);
        expect(results.groups.map(g => g.percent)).toEqual([75, 25, 0]);
        expect(results.groups[0].voters.map(v => v.fullName)).toEqual(["Bob", "Amy", "Zoe"]);
        expect(results.groups[0]).toMatchObject({ mine: true, leading: true, tied: false });
        expect(results.groups[2]).toMatchObject({ count: 0, leading: false });
    });
    test("only nonempty leaders are marked as tied", () => {
        expect(pollResults(poll({}), 1).groups.every(g => !g.leading && !g.tied)).toBe(true);
        expect(pollResults(poll({ 0: [voter(1, "A")], 1: [voter(2, "B")] })).groups.map(g => g.tied))
            .toEqual([true, true, false]);
    });
    test("validates 2–10 options and 500/200 limits before trimming blank extras", () => {
        expect(cleanPollDraft({ question: " Lunch? ", options: [" A ", " B ", " "], multiSelect: false }))
            .toEqual({ question: "Lunch?", options: ["A", "B"], multiSelect: false });
        expect(pollCreationError("q".repeat(500), ["a".repeat(200), "b"])).toBeNull();
        expect(pollCreationError("q".repeat(501), ["a", "b"])).toMatch(/500/);
        expect(pollCreationError("q", ["a".repeat(201), "b"])).toMatch(/200/);
        expect(pollCreationError("q", ["a", " "])).toMatch(/at least two/);
        expect(pollCreationError("q", Array(11).fill("a"))).toMatch(/2 and 10/);
        expect(pollCreationError("q", ["a"])).toMatch(/2 and 10/);
    });
});
