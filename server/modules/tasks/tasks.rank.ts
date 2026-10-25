/**
 * LexoRank ordering.
 *
 * A rank is a string that sorts lexicographically in the intended order, so a
 * move rewrites exactly one row. Clients never invent a rank: they send the
 * intended neighbours and the server computes the value here.
 *
 * Format: `<bucket>|<fraction>:`
 *   bucket    — "0" for the default bucket
 *   fraction  — base-36 digits, no trailing zeros
 */

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const MIN_CHAR = DIGITS[0];
const MAX_CHAR = DIGITS[DIGITS.length - 1];
const BUCKET = "0";

/** The rank used when a list is empty. */
export const INITIAL_RANK = `${BUCKET}|${DIGITS[Math.floor(DIGITS.length / 2)]}:`;

function fractionOf(rank: string): string {
    const body = rank.includes("|") ? rank.slice(rank.indexOf("|") + 1) : rank;
    return body.replace(/:$/, "");
}

function withBucket(fraction: string): string {
    return `${BUCKET}|${fraction}:`;
}

/** Compare two ranks in list order. */
export function compareRanks(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A rank strictly between `before` and `after`.
 *
 * `before` is the rank of the item that should end up above the moved item;
 * `after` is the rank of the item that should end up below it. Either may be
 * null at the ends of the list.
 */
export function rankBetween(before: string | null, after: string | null): string {
    if (!before && !after) return INITIAL_RANK;

    if (!before) {
        // Move to the top: step below the current first item.
        return withBucket(midpoint("", fractionOf(after!)));
    }
    if (!after) {
        // Move to the bottom: step above the current last item.
        return withBucket(midpoint(fractionOf(before), ""));
    }

    const low = fractionOf(before);
    const high = fractionOf(after);
    if (low >= high) {
        throw new Error(`Ranks are out of order: "${before}" is not before "${after}"`);
    }
    return withBucket(midpoint(low, high));
}

/**
 * A string strictly between two fractions.
 *
 * Walks the shared prefix, then picks a digit between the first differing
 * characters. When the lower bound is a prefix of the upper bound, it appends
 * a midpoint digit to the lower bound instead.
 */
function midpoint(low: string, high: string): string {
    if (low === "" && high === "") return DIGITS[Math.floor(DIGITS.length / 2)];

    if (low === "") {
        // Below the first item: take a digit before the high bound's first
        // character, or extend when that character is already the minimum.
        const first = high[0];
        const index = DIGITS.indexOf(first);
        if (index > 1) return DIGITS[Math.floor(index / 2)];
        return `${MIN_CHAR}${midpoint("", high.slice(1))}`;
    }

    if (high === "") {
        // Above the last item: take a digit after the low bound's first
        // character, or extend when that character is already the maximum.
        const first = low[0];
        const index = DIGITS.indexOf(first);
        if (index < DIGITS.length - 1) {
            return DIGITS[Math.min(DIGITS.length - 1, index + Math.ceil((DIGITS.length - 1 - index) / 2))];
        }
        return `${MAX_CHAR}${midpoint(low.slice(1), "")}`;
    }

    let prefix = "";
    let i = 0;
    while (i < low.length && i < high.length && low[i] === high[i]) {
        prefix += low[i];
        i += 1;
    }

    const lowChar = low[i] ?? MIN_CHAR;
    const highChar = high[i] ?? MAX_CHAR;
    const lowIndex = DIGITS.indexOf(lowChar);
    const highIndex = DIGITS.indexOf(highChar);

    if (highIndex - lowIndex > 1) {
        return prefix + DIGITS[Math.floor((lowIndex + highIndex) / 2)];
    }

    // Adjacent digits: keep the low character and recurse into the remainder.
    return prefix + lowChar + midpoint(low.slice(i + 1), "");
}

/**
 * Compute the rank for a move described by neighbours.
 *
 * Throws when the neighbours are not in order, so a stale client cannot
 * corrupt the sequence.
 */
export function rankForMove(
    before: string | null,
    after: string | null,
): string {
    return rankBetween(before, after);
}

/** Seed ranks for an existing list, in the order given. */
export function seedRanks(count: number): string[] {
    const ranks: string[] = [];
    let previous: string | null = null;
    for (let i = 0; i < count; i += 1) {
        const next = rankBetween(previous, null);
        ranks.push(next);
        previous = next;
    }
    return ranks;
}
