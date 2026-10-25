# 02: Task-collection query module

**What to build:** A prefactor: the three places that build a set of tasks (backlog, board, schedule) share one collection builder, so their filter, ordering and completed rules cannot diverge. Behaviour is unchanged. This makes the completed rule trustworthy in every view instead of being re-derived three times.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Backlog, board and schedule all obtain their task sets through the one module
- [ ] Existing endpoint responses are byte-identical to before the refactor
- [ ] The completed rule exists in exactly one place
- [ ] A test proves the three callers cannot produce different results for the same filter input
