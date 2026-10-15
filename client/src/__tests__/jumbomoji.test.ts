import { describe, expect, test } from "vitest";
import { jumbomojiSize } from "../components/chat/jumbomoji";

describe("jumbomojiSize", () => {
    test.each([
        ["😀", 48],
        ["😀😀", 40],
        ["👍🏽❤️🎉", 32],
        ["  😀  ", 48],
        ["😀 😀", 40],
        ["1️⃣", 48],
        ["🇮🇳", 48],
        ["👨‍👩‍👧", 48],
    ])("%s → %s px", (text, size) => {
        expect(jumbomojiSize(text)).toBe(size);
    });

    test.each([
        ["😀😀😀😀"],
        ["hi 😀"],
        ["1"],
        ["#"],
        ["hello"],
        [""],
        ["   "],
    ])("%j is not jumbo", (text) => {
        expect(jumbomojiSize(text)).toBeNull();
    });

    test("tolerates null/undefined content", () => {
        expect(jumbomojiSize(null)).toBeNull();
        expect(jumbomojiSize(undefined)).toBeNull();
    });
});
