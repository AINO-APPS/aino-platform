# Attendance module

Owns employee time-tracking behavior and its persistence boundary.

## Current migrated slice

- `POST /api/tracker/overtime-request`
- `GET /api/tracker/overtime-requests`
- `GET /api/tracker/theme`
- `PUT /api/tracker/theme`
- `GET /api/tracker/weekly`
- `GET /api/tracker/task-summary`
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
- `users` (display name and theme)

## Cross-module dependencies

- Approver resolution is injected from `utils/approver.ts`.
- WebSocket fan-out is injected from `utils/ws.ts`.
- Audit logging remains an HTTP cross-cutting concern in the route adapter.