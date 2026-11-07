# 02: Open a ticket by key, and aliases keep resolving

**What to build:** a person can paste or type a ticket key, current or former, and land on the ticket. A former key always opens the ticket and shows its current key. Search, the command palette and code-reference linking all use the same key lookup, so a branch, commit or pull request that mentions an old key still links to the right ticket. The ticket detail lists the ticket's former keys.

**Blocked by:** 01

**Status:** resolved

Spec: [projects-own-tickets](../spec.md). Decisions: ADR-017.

- [x] **The ticket key module** grows out of the existing issue-key helper:
  - **Pure functions:** parse keys from text (same pattern as today), format a key, and validate a project key.
  - **Resolving a key** looks at current ticket keys first, then aliases, and returns the ticket id and whether the key was an alias.
- [x] **A "fetch ticket by key" endpoint** returns the ticket, with a marker when the key was an alias. Visibility still follows the current policy. An unknown key, or a ticket the actor can't see, returns not found.
- [x] **Code-reference linking** resolves keys through the module, so an alias still links to the ticket.
- [x] **Search and the command palette** match a ticket's current key and its former keys.
- [x] **Ticket detail responses carry `key_aliases`.** The web ticket detail lists former keys.
- [x] **The web has a URL by ticket key** that opens the ticket. Opening an alias rewrites the URL to the current key.
- [x] **Unit tests:** the existing issue-key unit test is extended with formatting, project-key validation and parsing.
- [x] **Route test on real PostgreSQL:** fetching by current key and by alias, an unknown key, an invisible ticket, and a code reference that mentions an alias linking to the ticket.
- [x] **Web tests:** an alias URL redirects to the current key; former keys are shown; the command palette matches an alias.
- [x] **Contracts:** OpenAPI and contract tests cover the alias behavior, and parity checks pass. The route snapshot and inventory already include `/api/tasks/by-key/:key`, so no changes were needed there.
