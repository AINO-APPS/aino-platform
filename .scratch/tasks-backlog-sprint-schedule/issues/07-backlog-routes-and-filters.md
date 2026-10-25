# 07: Backlog routes and URL filters

**What to build:** Tabs become real routes: backlog, sprint board, sprint plan, schedule. Filters live in the query string so a view can be bookmarked and shared. Loading a route with filters restores exactly that view.

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] Each view has its own revisitable URL
- [ ] Filters for assignee, project, epic, type, priority, label and status round-trip through the URL
- [ ] Opening a shared URL reproduces the identical view
- [ ] An invalid or stale parameter degrades to the default rather than erroring
- [ ] Deep links to a specific task open its detail on arrival
