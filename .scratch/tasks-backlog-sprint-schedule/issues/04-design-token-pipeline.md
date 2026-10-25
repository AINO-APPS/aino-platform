# 04: Design token pipeline

**What to build:** One machine-readable token source generates the CSS variables the web client already uses, the Compose theme objects Android uses, and the SwiftUI theme iOS uses, with a CI check that fails on drift. No platform hand-maintains colour, spacing, type, radius, elevation or motion values.

**Blocked by:** None (can start immediately)

**Status:** ready-for-human

- [x] A single source file drives all three platform outputs
- [x] Generated files reproduce exactly from a clean checkout
- [x] CI fails when a generated file is edited by hand or falls out of date
- [x] Existing web values are preserved as the seed; visual regression on the current Tasks screens is unchanged
- [x] Density metrics for comfortable and compact are expressible as tokens

## Comments

**2026-10-25 — implemented**

- Commit `6ee374fd`. `contracts/design/tokens.json` seeds from the existing `client/src/global.css` values and drives all three platform outputs. `npm run tokens:validate` fails on a hand-edited generated file or a value that drifts from the stylesheet, and the drift check runs inside `contracts:validate`. Density metrics for comfortable and compact are token groups.
