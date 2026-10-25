# 16: Scope baseline surfaced

**What to build:** A sprint records what it committed when it started, and shows scope added and removed since. "Why didn't we finish" gains an answer without leaving the sprint.

**Blocked by:** 15

**Status:** done

- [x] Starting a sprint records committed points and the committed task set
- [x] Adding or removing scope after start re-records the baseline with a reason
- [x] The sprint shows scope added and removed in points
- [x] A sprint with no scope change shows zero, not a blank
- [x] The record is immutable for a completed sprint

## Comments

**2026-10-25 — implemented**

- Commit `cae44830`. Starting a sprint records committed points and the committed task set in `sprint_baselines`; an explicit scope add or remove re-records it with a reason. `GET /api/sprints/:id/stats` returns scope added and removed in points, reporting zero rather than blank when nothing changed. The record is immutable once the sprint completes.
