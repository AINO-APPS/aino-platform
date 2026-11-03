# Attendance module

Owns employee time-tracking behavior and its persistence boundary.

## Current migrated slice

- `POST /api/tracker/overtime-request`
- `GET /api/tracker/overtime-requests`
- `GET /api/tracker/theme`
- `PUT /api/tracker/theme`
- `GET /api/tracker/weekly`
- `GET /api/tracker/task-summary`
- `GET /api/tracker/task-time` (non-deleted worklogs grouped by recorded day worked; response shape unchanged)
- `GET /api/tracker/history`
- `GET /api/tracker/analytics`
- `GET /api/tracker/status`
- `GET /api/tracker/widgets`
- `POST /api/tracker/break-start`
- `POST /api/tracker/break-end`
- `POST /api/tracker/manual-entry`
- `PUT /api/tracker/manual-entry/:date`
- `GET /api/tracker/manual-entries`
- `GET /api/tracker/entries/:date`
- `DELETE /api/tracker/entries/:date`
- `POST /api/tracker/work-mode-request`

The remaining tracker endpoints still live in `routes/tracker.ts` and will move
incrementally. The public URL contract does not change: this router is mounted
inside the legacy tracker router.

## Layers

```text
attendance.routes.ts -> attendance.service.ts -> attendance.repository.ts
```

- Routes own HTTP parsing/status codes and audit calls.
- Service owns duplicate-request rules, approver orchestration and best-effort
  notification fan-out.
- Repository owns all SQL in this module and never imports Express.
- Schema validates untrusted request bodies before service invocation.

## Work-mode lock

The first clock-in of a local day fixes that day's work mode. `attendance.workMode.ts`
refuses a clock-in with another mode (`409 WORK_MODE_LOCKED`) unless an approved
`work_mode_change` request exists for that date, and creates those requests.
`attendance.workModeGuard.ts` is the adapter the legacy `POST /tracker/clock-in`
route calls. `GET /tracker/status` reports `lockedWorkMode` and `workModeRequest`.
Managers approve through the existing `/api/manager/approvals` endpoints.

## Tables read/written

- `approval_requests`
- `notifications`
- `users` (display name, theme, organization and timezone)
- `leaves` (approved leave by author and recorded date)
- `time_entries` (per-day attendance evidence)

## Cross-module dependencies

- Approver resolution is injected from `utils/approver.ts`.
- WebSocket fan-out is injected from `utils/ws.ts`.
- Audit logging remains an HTTP cross-cutting concern in the route adapter.

## Ticket time

`attendance.taskTime.ts` reads `task_worklogs` through this module's repository,
scoped to the author and their organization. Date ranges and grouping use the
recorded `day_worked`, not the current request's timezone. Soft-deleted entries
are excluded. The public tracker envelope remains `[{ date, minutes, entries }]`.
Attendance clock-in/out and its work timer are unchanged.

## Worklog attendance evidence

The service exports `hasApprovedLeaveForDate(db, userId, orgId, date)`, backed by
an organization-scoped repository query for approved leave on **any date**.
Unlike `listApprovedLeaveDates`, it has no recent-history window; pending,
rejected, withdrawn and revoked leave do not qualify.

`getWorklogDayAttendance(db, userId, orgId, date, nowMs?)` exposes `hasEntries`
and `floorMinutes`. The service re-exports both evidence reads from
`attendance.worklogEvidence.ts`. It uses the author's stored JavaScript timezone offset,
not the person saving/viewing the worklog, and the existing `computeDaySummary`.
Breaks are excluded, rejected entries are ignored, split shifts are combined,
and open historical sessions are capped at end of the local day (live ones at
now), matching attendance history. No entries is distinct from zero worked time.

Tasks calls these service exports only **after** a successful worklog commit to
compute advisory `ON_LEAVE` / `EXCEEDS_ATTENDANCE` warnings. Failure to read
attendance never blocks or rolls back a saved worklog; the worklog service logs
failed reads and keeps any independently available warning.

The real-PG HTTP seam is covered by
`server/__tests__/tasks.worklogRoutes.integration.test.ts`.