# Coding standards

Judgement rules for review. Mechanical rules live in guardrail scripts
(`npm run check:guardrails`, `server/.dependency-cruiser.cjs`); this file holds
only what no script can decide.

## Server data access

- **Every query in `server/modules/**` is scoped to the actor's org.** A tenant
  database can hold several organizations, so a lookup by id alone (a sprint, a
  ticket, a team) must also filter by `org_id`, directly or through a join.
- **Lock several rows in id order.** A `SELECT … FOR UPDATE` / `FOR SHARE` over
  more than one row carries `ORDER BY id`, so two overlapping transactions take
  the locks in the same order and cannot deadlock.
- **Side effects after commit.** Realtime emits and notifications triggered by a
  write inside `db.transaction` are registered with `afterCommit`, so a
  rolled-back write tells nobody.
