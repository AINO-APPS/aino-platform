/**
 * Signal-style "jumbomoji": messages made only of 1-3 emoji render large and
 * without a bubble. Mirrors the Android client's grapheme rules and sizes.
 */
const EMOJI_RE = /\p{Extended_Pictographic}|\p{So}|\u20E3/u;
const KEYCAP_RE = /\u20E3/u;
const LETTER_RE = /\p{L}/u;
const DIGIT_RE = /\p{N}/u;
const SPACE_RE = /\s/u;
const BLANK_RE = /^\s*$/u;

const SIZES_PX = [48, 40, 32] as const;
const MAX_EMOJI = SIZES_PX.length;

function graphemes(text: string): string[] {
    const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
    if (typeof Segmenter === "function") {
        return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
    }
    return Array.from(text);
}

function isEmojiCluster(cluster: string): boolean {
    if (!EMOJI_RE.test(cluster)) return false;
    if (LETTER_RE.test(cluster) || SPACE_RE.test(cluster)) return false;
    return !DIGIT_RE.test(cluster) || KEYCAP_RE.test(cluster);
}

/** Font size in px when `text` is 1-3 emoji only, otherwise null. */
export function jumbomojiSize(text: string | null | undefined): number | null {
    const trimmed = (text ?? "").trim();
    if (!trimmed) return null;
    let count = 0;
    for (const cluster of graphemes(trimmed)) {
        if (BLANK_RE.test(cluster)) continue;
        if (!isEmojiCluster(cluster)) return null;
        count += 1;
        if (count > MAX_EMOJI) return null;
    }
    return count > 0 ? SIZES_PX[count - 1] : null;
}
