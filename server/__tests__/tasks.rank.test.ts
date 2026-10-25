import {
    compareRanks,
    INITIAL_RANK,
    rankBetween,
    rankForMove,
    seedRanks,
} from "../modules/tasks/tasks.rank";

describe("LexoRank", () => {
    test("an empty list starts from a stable rank", () => {
        expect(rankBetween(null, null)).toBe(INITIAL_RANK);
    });

    test("a rank between two neighbours sorts between them", () => {
        const first = rankBetween(null, null);
        const second = rankBetween(first, null);
        const middle = rankBetween(first, second);

        expect(compareRanks(first, middle)).toBe(-1);
        expect(compareRanks(middle, second)).toBe(-1);
    });

    test("moving to the top sorts above the current first item", () => {
        const first = rankBetween(null, null);
        const top = rankBetween(null, first);
        expect(compareRanks(top, first)).toBe(-1);
    });

    test("moving to the bottom sorts below the current last item", () => {
        const first = rankBetween(null, null);
        const bottom = rankBetween(first, null);
        expect(compareRanks(first, bottom)).toBe(-1);
    });

    test("repeated insertion between the same neighbours stays ordered", () => {
        let low = rankBetween(null, null);
        const high = rankBetween(low, null);
        const inserted: string[] = [];

        for (let i = 0; i < 50; i += 1) {
            const next = rankBetween(low, high);
            inserted.push(next);
            low = next;
        }

        const sorted = [...inserted].sort(compareRanks);
        expect(inserted).toEqual(sorted);
        expect(new Set(inserted).size).toBe(inserted.length);
        for (const rank of inserted) {
            expect(compareRanks(rank, high)).toBe(-1);
        }
    });

    test("seeded ranks are unique and in creation order", () => {
        const ranks = seedRanks(25);
        expect(new Set(ranks).size).toBe(25);
        expect(ranks).toEqual([...ranks].sort(compareRanks));
    });

    test("out-of-order neighbours are rejected rather than corrupting the list", () => {
        const first = rankBetween(null, null);
        const second = rankBetween(first, null);
        expect(() => rankForMove(second, first)).toThrow(/out of order/i);
    });

    test("a move rewrites only the moved item's rank", () => {
        const ranks = seedRanks(5);
        // A rank between the first two items, inserted at that position.
        const moved = rankForMove(ranks[0], ranks[1]);
        const next = [...ranks];
        next.splice(1, 0, moved);

        // Every original rank is untouched; only the moved one is new.
        expect(next.filter((rank) => ranks.includes(rank))).toHaveLength(5);
        expect(next).toEqual([...next].sort(compareRanks));
    });
});
