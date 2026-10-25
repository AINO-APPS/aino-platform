# 17: Continuous team mode

**What to build:** A team can choose a rolling sprint instead of sprint ceremony. Work is carried forward automatically and the board shows current work without planning rituals, while the backlog keeps its meaning. The choice is made on web, where agile configuration lives, and every client reads the resulting mode.

**Blocked by:** 12

**Status:** done

- [x] A team can be set to continuous or sprints mode on web
- [x] In continuous mode work carries forward on cadence without manual sprint completion
- [x] The backlog still means "not in sprint" in both modes
- [x] Native clients read the resolved mode and do not attempt to change it
- [x] Switching modes does not lose or duplicate tasks

## Comments

**2026-10-25 — implemented**

- Commit `47648857`. Team mode is derived from `auto_managed` and surfaced through `useTeamMode` as Continuous or Sprints. In continuous mode one rolling sprint carries work forward without manual completion, and the backlog still means "not in sprint" in both modes. Mode is edited on web only (`canEditTeamMode`) and read by every client.
