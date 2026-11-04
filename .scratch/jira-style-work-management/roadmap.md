# Roadmap: Jira-style work management

**Date:** 2026-11-03
**Decisions:** [ADR-017](../../docs/adr/ADR-017-projects-own-tickets.md), [ADR-018](../../docs/adr/ADR-018-project-types.md), [ADR-019](../../docs/adr/ADR-019-manual-worklogs.md), [ADR-020](../../docs/adr/ADR-020-github-app-integration.md)
**Origin:** design interview 2026-11-03 (Q1–Q27)

Phases ship in order, and each one can be released on its own. A phase gets its spec (`/to-spec`) and tickets (`/to-tickets`) when it starts.

| Phase | Outcome | ADR | Spec |
|---|---|---|---|
| **1** | Manual worklogs with original and remaining estimates on web, desktop and Android. The timer UI is removed and timer history is converted into worklogs. | 019 | [manual-worklogs](../manual-worklogs/spec.md) |
| **2 — Shipped** | Projects own tickets: a mandatory project, a stored ticket key, key aliases, key rename, archive, project roles and a workflow per project. Existing tickets migrate into one project per team, plus `General`. Includes the Service Desk project. Platform 01–12 and Android 13 are integrated; per-org activation still requires review and switch-over. Validation gaps are recorded in [closeout](../projects-own-tickets/issues/14-docs-glossary-and-parity-closeout.md). | 017 | [projects-own-tickets](../projects-own-tickets/spec.md) |
| **3** | Project types (Scrum / Kanban / Task list). Removes the Scheduled container, automatic sprints and due-date re-timing. Planned day becomes a start date. Adds subtasks and one shared sprint-completion rule. A client-version gate (`426`) comes first, then old endpoints and columns are removed. | 018 | not yet written |
| **4** | GitHub App: installation-to-tenant mapping, Development panel, Create branch, smart commits and automation rules. The OAuth and manual webhook paths are removed. | 020 | not yet written |
| **5** | Admin home widget (one row per project plus a needs-attention list), My Work across projects, and timesheets (self / team lead / org admin, no approval). | — | not yet written |

## Gaps found in the current code (input for later phases)

| # | Gap | Phase |
|---|---|---|
| G1 | Teams own tickets, and projects only issue optional keys. Tickets without a key can't link to GitHub. | 2 |
| G2 | Teams without sprints get a day-based bucket or automatically rotating sprints, and the Sprint and Scheduled tabs swap places. | 3 |
| G3 | No standalone board, no subtasks, no per-project workflow, no key rename. Deleting a project drops its keys. | 2–3 |
| G6 | The sprint-completion default differs between the preview (next planned sprint) and the server (backlog). Subtasks are ignored. | 3 |
| G7 | GitHub connects through an OAuth app: the token is stored in plain text, webhooks are installed per repository and scan every tenant database, and the callback uses `postMessage('*')`. There are no smart commits or automation rules. | 4 |
| G8 | Service Desk copies have no project or key, their status isn't synced, and they are hard-deleted. | 2 |
| G9 | The server can't tell client versions apart, so endpoints can't be retired safely. | 3 |
