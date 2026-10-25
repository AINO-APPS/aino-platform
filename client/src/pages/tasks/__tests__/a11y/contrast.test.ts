/**
 * WCAG 2.1 AA contrast for every status, priority and epic indicator.
 *
 * jsdom has no layout engine, so axe cannot resolve `var(--token)` values and
 * `color-contrast` is meaningless there. This test asserts the token pairs
 * directly against the design-token source instead, which is the same source
 * every platform transcribes — so a token change that breaks contrast fails
 * here rather than in a screenshot review.
 *
 * The chips render as `color: <tone>; background: <tone> at 12.5% over the
 * card`, so the pair under test is the tone against its own tint.
 */
import { describe, expect, test } from "vitest";
import tokens from "../../../../../../contracts/design/tokens.json";

type Rgba = [number, number, number, number];

const COLOURS = tokens.tokens.color as Record<string, Record<string, string>>;
const THEMES = ["dark", "light"] as const;

/** The tone tokens the Tasks area uses for status, priority and epic chips. */
const INDICATOR_TOKENS = [
    "--primary",
    "--primary-light",
    "--success",
    "--warning",
    "--danger",
] as const;

/**
 * The ink token each tone uses for chip text.
 *
 * A chip renders `color: <tone>-ink; background: <tone> at 12.5%`, so the pair
 * under test is the ink against the tone's tint. The tone itself stays for the
 * rail, dot and border, where contrast is not a text requirement.
 */
const INK_FOR_TONE: Record<(typeof INDICATOR_TOKENS)[number], string> = {
    "--primary": "--primary-ink",
    "--primary-light": "--primary-light-ink",
    "--success": "--success-ink",
    "--warning": "--warning-ink",
    "--danger": "--danger-ink",
};

/** The chip background is the tone at 12.5% over the card surface. */
const CHIP_TINT_ALPHA = 0.125;

/** WCAG 2.1 AA for normal-size text. */
const AA_NORMAL = 4.5;

function parse(value: string): Rgba {
    const hex = value.trim();
    if (hex.startsWith("#")) {
        const body = hex.slice(1);
        if (body.length === 3) {
            return [
                parseInt(body[0] + body[0], 16),
                parseInt(body[1] + body[1], 16),
                parseInt(body[2] + body[2], 16),
                1,
            ];
        }
        return [
            parseInt(body.slice(0, 2), 16),
            parseInt(body.slice(2, 4), 16),
            parseInt(body.slice(4, 6), 16),
            1,
        ];
    }
    const match = /rgba?\(([^)]+)\)/.exec(hex);
    if (!match) throw new Error(`unsupported colour: ${value}`);
    const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

/** Composite a translucent colour over an opaque one. */
function over(foreground: Rgba, background: Rgba): Rgba {
    const alpha = foreground[3];
    return [
        foreground[0] * alpha + background[0] * (1 - alpha),
        foreground[1] * alpha + background[1] * (1 - alpha),
        foreground[2] * alpha + background[2] * (1 - alpha),
        1,
    ];
}

function luminance(colour: Rgba): number {
    const channel = (value: number) => {
        const scaled = value / 255;
        return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(colour[0]) + 0.7152 * channel(colour[1]) + 0.0722 * channel(colour[2]);
}

function contrast(a: Rgba, b: Rgba): number {
    const first = luminance(a);
    const second = luminance(b);
    const lighter = Math.max(first, second);
    const darker = Math.min(first, second);
    return (lighter + 0.05) / (darker + 0.05);
}

/** The card surface a chip sits on: `--card-bg` composited over `--bg`. */
function cardSurface(theme: (typeof THEMES)[number]): Rgba {
    const page = parse(COLOURS["--bg"][theme]);
    return over(parse(COLOURS["--card-bg"][theme]), page);
}

/** The chip background: the tone at 12.5% over the card surface. */
function chipBackground(tone: Rgba, surface: Rgba): Rgba {
    return over([tone[0], tone[1], tone[2], CHIP_TINT_ALPHA], surface);
}

describe("indicator contrast meets WCAG 2.1 AA", () => {
    for (const theme of THEMES) {
        for (const token of INDICATOR_TOKENS) {
            test(`${token} chip text is readable in the ${theme} theme`, () => {
                const surface = cardSurface(theme);
                const tone = parse(COLOURS[token][theme]);
                const ink = parse(COLOURS[INK_FOR_TONE[token]][theme]);
                const background = chipBackground(tone, surface);
                const ratio = contrast(ink, background);
                expect(
                    ratio,
                    `${INK_FOR_TONE[token]} (${theme}) is ${ratio.toFixed(2)}:1 against the ${token} chip tint; AA needs ${AA_NORMAL}:1`,
                ).toBeGreaterThanOrEqual(AA_NORMAL);
            });
        }
    }

    for (const theme of THEMES) {
        test(`body and secondary text are readable in the ${theme} theme`, () => {
            const surface = cardSurface(theme);
            for (const token of ["--text", "--text-secondary"] as const) {
                const ink = over(parse(COLOURS[token][theme]), surface);
                const ratio = contrast(ink, surface);
                expect(
                    ratio,
                    `${token} (${theme}) is ${ratio.toFixed(2)}:1 on the card surface; AA needs ${AA_NORMAL}:1`,
                ).toBeGreaterThanOrEqual(AA_NORMAL);
            }
        });
    }
});
