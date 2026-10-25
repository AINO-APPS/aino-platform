/**
 * Automated accessibility checks for the Tasks area.
 *
 * Every Tasks surface is rendered in jsdom and run through axe-core with the
 * WCAG 2.1 A/AA rule sets. A violation fails the test, so "the Tasks area is
 * accessible" is a build step rather than a promise.
 *
 * Colour contrast is checked separately (`contrast.ts`) because jsdom does not
 * compute styles: axe cannot resolve `var(--token)` values there, so the token
 * pairs are asserted directly against the design-token source instead.
 */
import { expect } from "vitest";
import axe from "axe-core";

/** WCAG 2.1 A + AA, which is the level the Tasks area commits to. */
const WCAG_AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export interface A11yResult {
    violations: axe.Result[];
}

/**
 * Run axe against a rendered container.
 *
 * `disableRules` exists for the handful of rules jsdom cannot evaluate (it has
 * no layout engine, so anything that needs geometry is meaningless). Every
 * disabled rule must be covered by a different check.
 */
export async function auditA11y(
    container: HTMLElement,
    options: { disableRules?: string[] } = {},
): Promise<A11yResult> {
    const results = await axe.run(container, {
        runOnly: { type: "tag", values: WCAG_AA_TAGS },
        rules: Object.fromEntries((options.disableRules ?? []).map((id) => [id, { enabled: false }])),
        resultTypes: ["violations"],
    });
    return { violations: results.violations };
}

/** Assert a rendered surface has no WCAG 2.1 AA violations. */
export async function expectAccessible(
    container: HTMLElement,
    options: { disableRules?: string[] } = {},
): Promise<void> {
    const { violations } = await auditA11y(container, options);
    const summary = violations.map((violation) => {
        const targets = violation.nodes.map((node) => node.target.join(" ")).join(", ");
        return `${violation.id} (${violation.impact}): ${violation.help} — ${targets}`;
    });
    expect(summary, `accessibility violations:\n${summary.join("\n")}`).toEqual([]);
}

/** Rules that need a layout engine and are covered elsewhere. */
export const LAYOUT_DEPENDENT_RULES = ["color-contrast", "target-size"];
