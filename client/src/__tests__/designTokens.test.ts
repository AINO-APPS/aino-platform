/**
 * Stylesheets may only use tokens the design system defines.
 *
 * `--radius-md` was never defined in `tokens.generated.css` (the scale is
 * `--radius`, `--radius-sm`, `--radius-full`), so every `border-radius` using
 * it silently fell back to the browser default.
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

describe("design tokens", () => {
    test("no stylesheet uses an undefined radius token", () => {
        const defined = new Set(
            [...fs.readFileSync(path.join(SRC, "styles", "tokens.generated.css"), "utf8")
                .matchAll(/(--radius[\w-]*)\s*:/g)].map((match) => match[1]),
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
});
