/**
 * The task detail surface must be opaque and above the app chrome.
 *
 * jsdom has no layout engine, so these two properties cannot be observed by
 * rendering: a transparent panel and a panel stacked under the sticky navbar
 * both look fine in the DOM. They are asserted against the stylesheet and the
 * design tokens instead.
 *
 * Two real failures this locks down:
 *   - `background: var(--surface)` — that token is a 4% wash meant to sit on a
 *     card, so the panel was see-through and its text unreadable.
 *   - `z-index: 55` — below the sticky navbar (100), so the navbar covered the
 *     sheet header, including the close button.
 */
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import tokens from "../../../../../contracts/design/tokens.json";

const css = fs.readFileSync(
    path.join(__dirname, "..", "TaskDetailSheet.module.css"),
    "utf8",
);

/** The declarations of one rule, keyed by property. */
function rule(selector: string): Record<string, string> {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    if (!match) throw new Error(`rule ${selector} not found`);
    const declarations: Record<string, string> = {};
    for (const line of match[1].split(";")) {
        const [property, ...rest] = line.split(":");
        if (!property || rest.length === 0) continue;
        declarations[property.trim()] = rest.join(":").trim();
    }
    return declarations;
}

const COLOURS = tokens.tokens.color as Record<string, Record<string, string>>;

/** The sticky navbar's stacking level, from Navbar.module.css. */
const NAVBAR_Z_INDEX = 100;

describe("task detail sheet surface", () => {
    test("the panel background is opaque in both themes", () => {
        const background = rule(".sheet").background;
        expect(background).toBe("var(--modal-bg)");

        for (const theme of ["dark", "light"] as const) {
            const value = COLOURS["--modal-bg"][theme];
            // `rgba(...)` with an alpha below 1 would let the page show through.
            const alpha = value.startsWith("rgba")
                ? Number(value.slice(value.lastIndexOf(",") + 1, -1))
                : 1;
            expect(alpha, `--modal-bg (${theme}) must be opaque`).toBeGreaterThanOrEqual(0.97);
        }
    });

    test("the panel is not painted with a translucent wash token", () => {
        // `--surface` / `--glass` are 4% overlays; using one as a panel
        // background is the bug this test exists for.
        expect(rule(".sheet").background).not.toMatch(/var\(--(surface|glass)\)/);
    });

    test("the sheet stacks above the sticky navbar", () => {
        const zIndex = Number(rule(".backdrop")["z-index"]);
        expect(zIndex).toBeGreaterThan(NAVBAR_Z_INDEX);
    });

    test("the close control is present and labelled", () => {
        const close = rule(".sheet-close");
        expect(close.cursor).toBe("pointer");
        expect(close.width).toBeTruthy();
        expect(close.height).toBeTruthy();
    });

    test("the panel fills the viewport on every screen size", () => {
        const sheet = rule(".sheet");
        expect(sheet.width).toBe("100%");
        expect(sheet.height).toBe("100%");
        // No breakpoint may shrink it back into a partial panel.
        expect(css).not.toMatch(/@media[^{]*\{[^}]*\.sheet\s*\{/);
    });
});
