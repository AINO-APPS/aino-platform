/**
 * Stylesheets may only use tokens the design system defines — and only tokens
 * that actually reach the browser.
 *
 * `--radius-md` was never defined in `tokens.generated.css` (the scale is
 * `--radius`, `--radius-sm`, `--radius-full`), so every `border-radius` using
 * it silently fell back to the browser default.
 *
 * The second failure mode is worse because it is invisible in review: the
 * generated file *did* define `--space-gutter`, `--space-control` and
 * `--font-meta-size`, but nothing imported it. Every `var()` for those resolved
 * to nothing at runtime — the Plan's panes lost their padding and gutter and its
 * rows collapsed — while the token files themselves still validated cleanly.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const SRC = path.join(__dirname, "..");

function cssFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return cssFiles(full);
        return entry.name.endsWith(".css") ? [full] : [];
    });
}

function definedTokens(css: string, prefix = "--"): Set<string> {
    return new Set(
        [...css.matchAll(new RegExp(`(${prefix}[\\w-]*)\\s*:`, "g"))].map((m) => m[1]),
    );
}

describe("design tokens", () => {
    test("no stylesheet uses an undefined radius token", () => {
        const defined = definedTokens(
            fs.readFileSync(path.join(SRC, "styles", "tokens.generated.css"), "utf8"),
            "--radius",
        );
        const offenders = cssFiles(SRC).flatMap((file) => {
            const css = fs.readFileSync(file, "utf8");
            return [...css.matchAll(/var\((--radius[\w-]*)\)/g)]
                .map((match) => match[1])
                .filter((token) => !defined.has(token))
                .map((token) => `${path.relative(SRC, file)}: ${token}`);
        });

        expect(offenders).toEqual([]);
    });

    test("the generated tokens are actually imported, next to global.css", () => {
        const entry = fs.readFileSync(path.join(SRC, "main.tsx"), "utf8");
        expect(entry).toMatch(/styles\/tokens\.generated\.css/);
    });

    test("every design-system token a stylesheet references is defined by a stylesheet that loads", () => {
        // Only these reach the browser: the entry point imports exactly these
        // (plus per-module sheets, which define no `:root` tokens).
        const runtime = new Set([
            ...definedTokens(fs.readFileSync(path.join(SRC, "styles", "tokens.generated.css"), "utf8")),
            ...definedTokens(fs.readFileSync(path.join(SRC, "global.css"), "utf8")),
        ]);

        // Only the design system's own scale-groups are checked here. Components
        // legitimately introduce local properties (`--badge-bg`, `--sparkline`)
        // that are set inline on an element rather than declared in a sheet.
        const designSystem =
            /^--(space-(page|gutter|control)|font-(body|title|meta)-(size|line)|density-[\w-]+)$/;

        const offenders = cssFiles(SRC).flatMap((file) => {
            const css = fs.readFileSync(file, "utf8");
            return [...css.matchAll(/var\((--[\w-]+)/g)]
                .map((match) => match[1])
                .filter((token) => designSystem.test(token))
                .filter((token) => !runtime.has(token))
                .map((token) => `${path.relative(SRC, file)}: ${token}`);
        });

        expect(offenders).toEqual([]);
    });
});
