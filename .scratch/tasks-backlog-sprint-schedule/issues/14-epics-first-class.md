# 14: Epics first class

**What to build:** Epics become usable rather than merely present: an epic indicator on cards, an epic filter across the views, a progress rollup showing completed against total for each epic, and an epics panel while planning.

**Blocked by:** 12

**Status:** done

- [x] Cards in an epic show the epic indicator
- [x] Filtering by epic works in backlog, board and plan
- [x] Each epic reports completed versus total, in count and in points
- [x] The epics panel lists epics with their rollups while planning
- [x] An epic with no children renders sensibly rather than as an error

## Comments

**2026-10-25 — implemented**

- Commit `e50e4b07`. `EpicPanel` lists epics with completed-versus-total in both count and points. Cards carry an epic indicator, and the epic filter works in backlog, board and plan. An epic with no children renders an empty rollup rather than an error.
