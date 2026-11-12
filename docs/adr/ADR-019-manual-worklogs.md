# ADR-019: Time on tickets is recorded only as manual worklogs

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

Today, time on a ticket can only be recorded with a start/stop timer
(`task_timers`). Stopping it adds to a running total in `tasks.logged_minutes`.
The current design has these problems:
- Entries can't be back-dated, commented, edited or deleted.
- The running total can drift from the timer rows.
- A forgotten timer is never stopped.
- No route writes `estimated_minutes`, so the estimate never works.

## Decision

The timer is removed. Time is recorded only as **worklogs**: day worked, time
spent, an optional start time and a comment, by default written by the person who did
the work. Project admins and org admins may log, edit or delete worklogs on behalf
of someone else, and the entry records both who did the work and who logged it. **Time spent** is always
the sum of the worklogs and is never stored separately. Tickets carry an
**original estimate** and a **remaining estimate**. Logging work adjusts the
remaining estimate automatically by default, as Jira does. A worklog that
conflicts with attendance (leave, or more time than the person was clocked in)
produces a warning and is still saved.

## Consequences

- Finished timer runs are converted into worklogs dated the day they started. The
  `task_timers` table and `tasks.logged_minutes` are dropped later, in a separate
  step.
- Timer endpoints, the Start/Stop UI and the timer in native clients are removed.
- Timesheets read worklogs.

## Alternatives considered

- **Keep the timer as one way to create a worklog.** Rejected at the owner's
  request. Manual entry is the Jira habit the organization expects, and a second
  way of recording time reintroduces the forgotten-timer problem.
