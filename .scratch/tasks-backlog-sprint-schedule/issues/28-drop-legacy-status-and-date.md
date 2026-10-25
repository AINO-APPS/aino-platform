# 28: Drop legacy status and date

**What to build:** The contract step of the wide refactor: once no client reads the old status column or the old ambiguous date column, they are removed. One status remains — the workflow state — and one planned date remains. The parallel numeric order column is removed too.

**Blocked by:** 25, 26, 27

**Status:** ready-for-agent

- [ ] No client or server code reads the legacy status, date or numeric order columns
- [ ] The columns are removed from both the migration layer and the base tenant schema definition
- [ ] A newly created tenant and an upgraded tenant still end identical
- [ ] Removing the columns leaves every existing task intact and correctly categorised
- [ ] Full test suites for all four clients pass after removal
