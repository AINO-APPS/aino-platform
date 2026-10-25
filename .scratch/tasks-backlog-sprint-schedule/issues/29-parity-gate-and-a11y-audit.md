# 29: Parity gate and accessibility audit

**What to build:** "Same features everywhere" is enforced rather than promised. The parity matrix is checked in CI and fails the build when a feature ships on web with no counterpart or explicit waiver elsewhere. The whole Tasks area is audited to WCAG 2.1 AA.

**Blocked by:** 26, 27

**Status:** done

- [x] CI fails when a feature is shipped on web but neither shipped nor waived elsewhere
- [x] CI fails when a shipped feature has no owning test
- [x] Desktop is tracked as the web bundle and cannot diverge from web
- [x] Every Tasks surface passes an automated accessibility check
- [x] Contrast requirements are met on all status, priority and epic indicators
- [x] Drag results and undo are announced to assistive technology
## Comments

**2026-10-25 — implemented**

### Parity gate

- `scripts/validate-tasks-parity.mjs` gained rule 12: every `shipped`
  `owner_test` must exist on disk, resolved against the client's own repository
  (`web`/`desktop` → platform repo, `android` → `aino-android`, `ios` →
  `aino-ios`). A feature with no owning test now fails the build instead of
  being a claim.
- `contracts/tests/tasks-parity.test.mjs` covers the new rule plus an explicit
  "desktop mirrors web" assertion over the committed matrix.
- `.github/workflows/ci.yml` runs the parity validator as its own step, so the
  drift gate is a build failure rather than a convention.
- The matrix itself was corrected: `parity-ci-gate` claimed an Android owner
  test that lived in the platform repo (now waived with a reason), and
  `a11y-wcag-aa` / `parity-ci-gate` are now `shipped` on web + desktop with the
  real owning tests.

### Accessibility audit

- `client/src/pages/tasks/__tests__/a11y/axe.ts` — axe-core harness pinned to
  the WCAG 2.1 A/AA tag sets. `LAYOUT_DEPENDENT_RULES` documents the two rules
  jsdom cannot evaluate (`color-contrast`, `target-size`).
- `tasksA11y.test.tsx` audits every Tasks surface: backlog card, board card,
  board, sprint plan, schedule calendar, completed section (collapsed and
  expanded), bulk action bar, command palette, shortcut help and the detail
  sheet. It also asserts the board's `aria-live="polite"` move announcement and
  that undo is a real focusable button.
- `contrast.test.ts` asserts the token pairs directly against
  `contracts/design/tokens.json`, because jsdom cannot resolve `var(--token)`.

### Defects the audit found and fixed

- **Schedule calendar** — `role="grid"` had `gridcell` children with no
  `role="row"` between them. Added a `display: contents` row wrapper so the CSS
  grid layout is unchanged.
- **Completed section** — `aria-controls` pointed at an element that is not
  rendered while collapsed. It is now only set when the list exists.
- **Bulk action bar** — "Backlog" and "Unassigned" shared `value=""` with the
  placeholder, so those actions were unreachable. They now have distinct values.
- **Chip contrast** — every status/priority/epic chip rendered its tone as text
  on a 12.5% tint of the same tone: 2.5–3.9:1, well under AA. Added
  `--primary-ink`, `--primary-light-ink`, `--success-ink`, `--warning-ink` and
  `--danger-ink` to the token source (both themes), wired `PRIORITIES`,
  `COLUMNS`, `statusOptions` and the chip CSS to them, and raised the light
  theme's `--text-secondary` from 0.65 to 0.68 alpha (4.19:1 → 4.57:1).