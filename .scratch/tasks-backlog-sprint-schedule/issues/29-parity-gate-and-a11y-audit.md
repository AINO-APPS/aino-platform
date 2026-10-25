# 29: Parity gate and accessibility audit

**What to build:** "Same features everywhere" is enforced rather than promised. The parity matrix is checked in CI and fails the build when a feature ships on web with no counterpart or explicit waiver elsewhere. The whole Tasks area is audited to WCAG 2.1 AA.

**Blocked by:** 26, 27

**Status:** ready-for-agent

- [ ] CI fails when a feature is shipped on web but neither shipped nor waived elsewhere
- [ ] CI fails when a shipped feature has no owning test
- [ ] Desktop is tracked as the web bundle and cannot diverge from web
- [ ] Every Tasks surface passes an automated accessibility check
- [ ] Contrast requirements are met on all status, priority and epic indicators
- [ ] Drag results and undo are announced to assistive technology
