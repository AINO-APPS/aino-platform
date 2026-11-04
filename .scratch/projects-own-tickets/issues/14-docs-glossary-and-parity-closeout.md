# 14: Docs, glossary and parity closeout

**What to build:** the written record matches what shipped:

- The glossary and ADR-017 read cleanly.
- Module docs describe projects owning tickets.
- Every parity and PostgreSQL suite is green on the integrated branch.

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13

**Status:** ready-for-agent

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017.

- [ ] **GLOSSARY:**
  - Remove the Unassigned entry.
  - Placement: a project move replaces team transfer.
  - Fix the entries that run together: Placement/Sprint, Current sprint, Board, Unassigned and Worklog/Timesheet.
  - Note that teams are never tied to one project.
- [ ] **ADR-017:** fix the Consequences bullet where the workflow text runs into the Service Desk text. Record that creating a project needs team lead or above.
- [ ] **ADR-013:** add a cross-reference saying it is superseded.
- [ ] **The tasks module README and the projects and Service Desk docs** describe project ownership, roles, aliases, archive and the switch-over.
- [ ] **The roadmap's Phase 2 row** is marked shipped once the work merges.
- [ ] **The full integrated runs pass** with no skips: the PostgreSQL test script, the server suite, the web suite, the focused Android tests, contracts validation, tasks parity, Android endpoint and realtime parity, typechecks and guardrails.
