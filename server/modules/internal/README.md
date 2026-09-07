# Internal observability module

Owns platform-admin-only process, database-pool and migration diagnostics mounted at `/api/internal`.

The route is an HTTP adapter. Migration orchestration lives in `internal.service.ts`; the only SQL lives in `internal.repository.ts`. WebSocket and pool metrics remain injected platform concerns.