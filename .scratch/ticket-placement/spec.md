# Spec — Ticket placement: one module for every container write

**Status:** ready-for-agent
**Date:** 2026-11-01
**Surfaces:** server only (`server/`). Web, desktop and Android are unchanged apart from one new error code.
**Decisions:** [ADR-015](../../docs/adr/ADR-015-three-planning-containers.md) (amended 2026-11-01), [ADR-013](../../docs/adr/ADR-013-ticket-team-ownership.md), [ADR-014](../../docs/adr/ADR-014-workflow-transition-enforcement.md)
**Vocabulary:** [GLOSSARY.md](../../GLOSSARY.md) — Placement, Planned day, Due date, Sprint, Backlog
**Origin:** architecture review 2026-11-01, candidate #1

---

## 1. Problem

ADR-015 puts the container predicates in one read-side module
(`tasks.collection.ts`), but **placement** — the writes that move a ticket
between sprint, Scheduled and backlog — has no module. Twelve call sites write
`sprint_id`, `planned_date`, `due_date` and `pre_sprint_due_date` directly, and
they disagree:

| # | Defect | Where |
|---|--------|-------|
| B1 | A bulk sprint move remembers the own due date but never sets `due_date` to the sprint's end, unlike a single move. | `routes/tasks/bulk.ts:128` → `tasks.repository.ts:117` (`setSprint`) vs `tasks.sprintRepository.ts:186` (`setSprintAndDueDate`) |
| B2 | Sprint carry-over keeps the **old** sprint's end date as `due_date`, so carried tickets look overdue in the new sprint. | `routes/sprints.ts:447-451` |
| B3 | Sprint completion runs three UPDATEs with no transaction; the "already completed" guard is read-then-check (`:416`), so two concurrent requests can both carry tickets. | `routes/sprints.ts:409-490` |
| B4 | Team transfer clears the sprint in inline SQL with no sprint history or realtime. | `tasks.ownership.ts:174` |
| B5 | `PATCH /:id/schedule` writes `planned_date` with no team, freeze or in-sprint check; `PUT` can set it on a sprinted ticket. | `routes/tasks/backlog.ts:362-399`, `crud.ts:563-568` |
| B6 | Editing or resuming a sprint changes `end_date` but not its tickets' due dates. | `routes/sprints.ts:145-147, 557-560` |
| ~~B7~~ | *Not a defect (2026-11-01).* Scope change is computed at read time against the latest baseline (`routes/sprintBaseline.ts:51`); writing a snapshot per move would zero that delta. | — |
| B8 | Realtime and notifications are emitted synchronously inside handlers, some before the write is safe; there is no post-commit hook. | `routes/tasks/_helpers/statusEvents.ts:53-63` |

Write paths today: create (`crud.ts:235-249`), quick-add (`backlog.ts:323-337`),
PUT (`crud.ts:374-601`), sprint join/leave (`routes/tasks/sprints.ts:123-165`),
bulk (`bulk.ts:112-139`), schedule/unschedule (`backlog.ts:362-399`), sprint
complete (`sprints.ts:433-476`), sprint delete (`sprints.ts:184`), team transfer
(`tasks.ownership.ts:162-176`), sprint edit/resume (`sprints.ts:115-170, 544-560`).
Only create, quick-add and carry-forward run in a transaction.

## 2. Solution

One deep module, `server/modules/tasks/tasks.placement.ts`, owns every placement
write; its SQL lives in `tasks.placementRepository.ts`, and
`tasks.placementEffects.ts` is the production adapter for realtime and
notifications. Routes become thin adapters that translate HTTP to a placement
call. As built in issue 02:

```ts
type PlacementTarget = { sprint: number } | { sprint: null } | { day: string } | "backlog";
// ctx = { db: tx client, afterCommit, actor: { userId, orgId, ip?, userAgent? }, effects }
placeTickets(ctx, ticketIds, target): Promise<PlacementResult[]>   // per ticket: { ok: true, task } | { ok: false, code, error }
transferTicket(ctx, ticketId, toTeamId): Promise<PlacementResult>
retimeSprintDueDates(ctx, sprintId, oldEnd, newEnd): Promise<number>
realtimeEffects({ db, tenantId }): PlacementEffects                 // pass as ctx.effects
```

## 3. Decisions

| # | Decision |
|---|----------|
| P1 | **Scope.** The module owns container moves (`sprint_id`, `planned_date`), the due-date bookkeeping (`due_date` ↔ `pre_sprint_due_date`) and team transfer. Rank/reorder is **out**. |
| P2 | **Create.** Insert with no container, then place in the same transaction. Creation stays exempt from transitions (ADR-014). |
| P3 | **Due date on sprint entry.** Every entry — single, bulk, carry-over sprint → sprint — sets `due_date` to the target sprint's end. The own due date is remembered on first entry only and restored when the ticket leaves sprints. |
| P4 | **Planned day while in a sprint.** An existing planned day survives sprint entry (sprint wins) and takes effect again when the ticket leaves the sprint. A ticket in a sprint cannot be **given** a new one: `PATCH /:id/schedule` → `409 IN_SPRINT`; `PUT` ignores `planned_date` for a sprinted ticket. |
| P5 | **Interface.** One placement call for single and bulk; `transferTicket` separate because it changes the owner, not the container. Precedence rules stay internal. |
| P6 | **Side effects.** History and audit (`audit_logs`, with the actor's ip/user agent) written inside the transaction. Each committed move is handed to `ctx.effects.changed` via `afterCommit`; the production adapter `realtimeEffects` sends `task_updated` (both teams on transfer) and the sprint-added notification on sprint entry. Rollback emits nothing. |
| P7 | **Sprint end-date moves.** `retimeSprintDueDates` re-points members whose `due_date` still equals the old end; hand-edited due dates are left alone. Called by sprint edit and resume. |
| P8 | **Freeze.** The module rejects placement into or out of a completed sprint (`SPRINT_FROZEN`) for every caller. Sprint completion places its tickets before flipping status, so it is not blocked. |
| P9 | ~~Scope baselines~~ **Dropped (2026-11-01).** Placement does not write `sprint_baselines`: `GET /sprints/:id/baseline` diffs current scope against the latest row, so a snapshot per move would always report zero scope change. |
| P10 | **Bulk.** Validate every ticket first (team, freeze, in-sprint), then write all valid ones in **one** transaction; skipped tickets get a per-ticket code. An unexpected DB error rolls back the whole batch. |
| P11 | **Sprint completion.** One transaction: claim with `UPDATE sprints SET status='completed' … WHERE id=$1 AND status <> 'completed' RETURNING` (no row → 409), snapshot burndown + velocity, place unfinished tickets (next sprint or out of sprints), record provenance. Notifications after commit. Completion stays in sprint lifecycle and only *calls* placement. |
| P12 | **Sprint deletion.** Members leave the sprint through placement in the delete's transaction (per-ticket history/realtime; a planned day → Scheduled per P4). |
| P13 | **Realtime volume.** N `task_updated` events per N tickets; no new event type. |
| P14 | **Replaced.** `setSprint`, `setSprintAndDueDate`, `clearSprint`, exported `LEAVE_SPRINT` / `REMEMBER_DUE_DATE`, and inline placement SQL in `sprints.ts` and `tasks.ownership.ts`. |
| P15 | **Tests.** Table-driven suite against real PostgreSQL (`from container × target × due-date state → row + history + outbox`). Mocked-SQL tests for replaced paths (e.g. `tasks.sprintDueDate.test.ts`) are deleted, not layered. Route tests keep only HTTP mapping. |
| P16 | **Rollout.** No flag. `contracts/` gains the `IN_SPRINT` error code. |

## 4. Placement rules (truth table)

| From | Move | `sprint_id` | `planned_date` | `due_date` | `pre_sprint_due_date` |
|------|------|-------------|----------------|------------|-----------------------|
| backlog / Scheduled | join sprint S | S | kept | S.end | old `due_date` |
| sprint A | join sprint S | S | kept | S.end | kept |
| sprint A | leave sprint (unassign, completion, deletion, transfer) | NULL | kept → Scheduled if set | `pre_sprint_due_date` | NULL |
| Scheduled | back to backlog | — | NULL | unchanged | — |
| backlog / Scheduled | schedule on day d | — | d | unchanged | — |
| sprint A | schedule on day d | — | — | — | → `409 IN_SPRINT` |
| completed sprint A | any move | — | — | — | → `SPRINT_FROZEN` |
| any | join sprint S of another team | — | — | — | → `SPRINT_TEAM_MISMATCH` |

Leaving a sprint keeps the planned day, matching today's `clearSprint` and P4.
Whether "leave sprint" and "back to backlog" are one target or two in the
interface is decided in issue 02.

## 5. Out of scope

Rank/reorder; workflow transitions (the ADR-014 helper is untouched); client
refactors (review candidates #2–#4); a batched realtime event.

## 6. Issues

1. [01 — afterCommit outbox on db.transaction](issues/01-after-commit-outbox.md)
2. [02 — Placement module and its PostgreSQL suite](issues/02-placement-module.md)
3. [03 — Ticket routes place through the module](issues/03-ticket-routes-use-placement.md)
4. [04 — Bulk sprint move through placement](issues/04-bulk-uses-placement.md)
5. [05 — Transactional sprint completion and deletion](issues/05-sprint-complete-and-delete.md)
6. [06 — Team transfer through placement](issues/06-transfer-uses-placement.md)
7. [07 — Re-time due dates when a sprint's end moves](issues/07-retime-sprint-due-dates.md)
8. [08 — IN_SPRINT in contracts](issues/08-in-sprint-contract.md)
