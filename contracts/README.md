# HTTP contract baseline

This directory records the server's first machine-readable HTTP contract baseline.

- `http-route-inventory.json` inventories every router mounted by `server/http/routes.ts`, every concrete endpoint in the server's tested route snapshot, standalone health/metrics routes, and per-endpoint OpenAPI coverage.
- `openapi.json` is an OpenAPI 3.1 document for health, authentication/bootstrap, profile, and the main mobile-facing groups (tracker, leaves, tasks, calendar, meetings, notifications, chat, presence, search, projects, and public bootstrap resources).
- `generate-baseline.mjs` deterministically rebuilds both JSON files from the server route snapshot and the reviewed baseline metadata. Run it deliberately when server routes change, then review the diff.
- `mobile-route-map.json` maps every Axios wrapper call from the immutable legacy mobile commit to the tested server inventory and classifies it as `active`, `stale`, or `method-mismatch`.
- `generate-mobile-route-map.mjs` rebuilds that derived map without copying mobile source into this repository. Run `node contracts/generate-mobile-route-map.mjs D:\\Learnings\\WorkPulse d9d779c7520dbf052ba587ac2af649ec59920864`, then review the classifications.

Validate with `npm run contracts:validate` from the repository root.

The mobile map covers backend calls made through the shared Axios `api` instance. Direct external `fetch` calls (for application updates, GitHub releases, and geocoding) are intentionally excluded because they are not AINO server routes. Validation fails if any wrapper call could not be resolved to a string or template-literal path.

## Scope and limitations

`coverage: "operation"` means the method/path, authentication alternatives, mutating-request CSRF header, common errors, parameters, and response envelope are represented in OpenAPI. It does **not** claim every endpoint payload is exhaustively modeled. The most bootstrap-critical schemas (login, registration, auth response, profile, health, device token, clock events, and presence) have initial field-level schemas. Other baseline operations intentionally use `FreeFormValue` until their handlers and tests are converted into precise reusable schemas. Routers marked `inventory-only` are tracked but not yet described as OpenAPI operations.

The server accepts either the `token` HttpOnly cookie or `Authorization: Bearer <jwt>` (cookie wins). Native clients use bearer authentication. Every mutating `/api` request except external webhooks must send `X-Requested-With: AINO` (the legacy `WorkPulse` value is also accepted). Tenant context is resolved from the verified JWT first, then from the request host/custom domain.

## Realtime and push baseline

- `asyncapi/aino-realtime.yaml` records the `/ws` handshake/authentication path, `{ type, data }` envelope, core chat/call commands and events, and the server's idempotency semantics.
- `schemas/push/*.schema.json` model the FCM data records emitted by `server/services/pushNotifications.ts` for incoming calls, call teardown, chat messages, and general alerts.
- `fixtures/push/*.json` are deterministic canonical examples. Incoming-call fixtures include both visible-caller and `hideSensitiveContent` variants.
- `tests/realtime-contracts.test.mjs` and `scripts/validate-realtime-contracts.mjs` use only Node built-ins. Run `node --test contracts/tests/*.test.mjs`, or use `npm run contracts:validate` to validate HTTP and realtime contracts together.

### Known coverage gaps

This is intentionally a baseline, not an exhaustive realtime specification. AsyncAPI currently omits detailed schemas for typing/read, WebRTC signal/reconnect/ready/subscribe/reaction, meetings/huddles, presence/status, notifications, and group-management events. Several documented server events retain open `data` objects because their exact payload varies by transition. Push schemas cover the server-built FCM `data` map, not provider-added metadata or every platform wrapper (`android`, `apns`, `webpush`). Only incoming-call push currently has a server-side `hideSensitiveContent` variant; message and general-alert builders do not consult that preference, so no unsupported privacy variant is asserted for them.
