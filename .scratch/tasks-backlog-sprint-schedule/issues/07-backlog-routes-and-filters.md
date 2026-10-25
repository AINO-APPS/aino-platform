# 07: Backlog routes and URL filters

**What to build:** Tabs become real routes: backlog, sprint board, sprint plan, schedule. Filters live in the query string so a view can be bookmarked and shared. Loading a route with filters restores exactly that view.

**Blocked by:** 05

**Status:** done

- [x] Each view has its own revisitable URL
- [x] Filters for assignee, project, epic, type, priority, label and status round-trip through the URL
- [x] Opening a shared URL reproduces the identical view
- [x] An invalid or stale parameter degrades to the default rather than erroring
- [x] Deep links to a specific task open its detail on arrival

## Comments

**2026-10-25 — implemented**

- Commit `a341ad79, df642fa3`. Tabs are real routes under `/tasks`, with filters in the query string and one-shot legacy-param parsing that strips them via `replace`. `useTasksRoute` owns the shared filter vocabulary; an invalid or stale parameter falls back to the default rather than erroring, and `?task=<id>` deep-links to the detail.
