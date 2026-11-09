# 02: Start dates without Scheduled placement

**What to build:** A ticket's planned day becomes its start date. Members can view and edit it, and every date-driven read uses it, while older clients continue to work through the legacy field and request shape.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Tickets have a nullable start date, and existing planned days are copied into it by an idempotent migration.
- [ ] Ticket detail and edit behavior use start date; date changes are recorded in history and do not change placement.
- [ ] A due date earlier than the start date is refused with a clear error.
- [ ] Search, export, notes, manager views, attendance day views, My Work and dashboard date windows use start date.
- [ ] Legacy `planned_date` request and response fields remain available and map to start date without losing data.
- [ ] Re-running the migration changes nothing after the first successful run.
