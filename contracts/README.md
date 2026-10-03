# HTTP contract baseline

This directory records the server's first machine-readable HTTP contract baseline.

- `http-route-inventory.json` inventories every router mounted by `server/http/routes.ts`, every concrete endpoint in the server's tested route snapshot, standalone health/metrics routes, and per-endpoint OpenAPI coverage.
- `openapi.json` is an OpenAPI 3.1 document for health, authentication/bootstrap, profile, and the main mobile-facing groups (tracker, leaves, tasks, calendar, meetings, notifications, chat, presence, search, projects, and public bootstrap resources).
- `generate-baseline.mjs` deterministically rebuilds both JSON files from the server route snapshot and the reviewed baseline metadata. Run it deliberately when server routes change, then review the diff.
- `mobile-route-map.json` maps every Axios wrapper call from the immutable legacy mobile commit to the tested server inventory and classifies it as `active`, `stale`, or `method-mismatch`.
- `generate-mobile-route-map.mjs` rebuilds that derived map without copying mobile source into this repository.

### Regenerating the mobile route map

`mobile-route-map.json` is committed and authoritative. Regeneration is deliberate and rare, and it is the one task in this repository that still needs the pre-split monorepo: the `mobile/` tree it reads was never copied here.

Point the generator at a clone of the **archived** legacy repository, which must be preserved read-only rather than deleted:

```bash
AINO_LEGACY_REPO=/path/to/legacy-clone node contracts/generate-mobile-route-map.mjs
# or: node contracts/generate-mobile-route-map.mjs /path/to/legacy-clone
```

The legacy commit is pinned to `d9d779c7520dbf052ba587ac2af649ec59920864` and is also asserted by `scripts/validate-contracts.mjs`, so the map always describes that immutable history. The generator fails with an explicit message when the clone or the commit is unavailable. After regenerating, review the classification diff.

Validate with `npm run contracts:validate` from the repository root.

The mobile map covers backend calls made through the shared Axios `api` instance. Direct external `fetch` calls (for application updates, GitHub releases, and geocoding) are intentionally excluded because they are not AINO server routes. Validation fails if any wrapper call could not be resolved to a string or template-literal path.

## Scope and limitations

`coverage: "operation"` means the method/path, authentication alternatives, mutating-request CSRF header, common errors, parameters, and response envelope are represented in OpenAPI. It does **not** claim every endpoint payload is exhaustively modeled. The most bootstrap-critical schemas (login, registration, auth response, profile, health, device token, clock events, and presence) have initial field-level schemas. Other baseline operations intentionally use `FreeFormValue` until their handlers and tests are converted into precise reusable schemas. Routers marked `inventory-only` are tracked but not yet described as OpenAPI operations.

The seven notification operations are fully modeled from their handler and database schema, including pagination, integer path IDs, bounded metric-event batches, delivery metrics, announcements, and mutation acknowledgements. Contract validation rejects any notification operation that regresses to `FreeFormValue`.

The global search operation is fully modeled across its seven result groups. Missing or short queries use the same stable empty-array envelope as successful searches, and contract validation rejects a regression to `FreeFormValue`.

`GET /api/tracker/status` is modeled as `TrackerStatus`. Its `floorSeconds` / `breakSeconds` integers are the exact worked/break seconds at response time (`floorMinutes === floor(floorSeconds / 60)`); contract validation requires both fields because native and web live timers anchor on them.

The server accepts either the `token` HttpOnly cookie or `Authorization: Bearer <jwt>` (cookie wins). Native clients use bearer authentication. Every mutating `/api` request except external webhooks must send `X-Requested-With: AINO` (the legacy `WorkPulse` value is also accepted). Tenant context is resolved from the verified JWT first, then from the request host/custom domain.

Administration is web-only (2026-10-01). Admin routes answer `403 { code: "WEB_ONLY" }` to native-app requests: a bearer-authenticated request, a token minted for the app (`cli: "mobile"` claim, stamped when the client sends `X-AINO-Client: android` or refreshes over bearer), or a request carrying `X-AINO-Client: android`. Gated: `/api/admin/**`, `/api/platform-access`, `/api/internal`, `/api/compensation` except `/my-*`, `/api/branding` except `GET /`, `/api/projects` writes, agile editor/reviewer routes, and `PUT /api/org/settings`, `POST /api/org/invite`, `POST /api/org/remove-member`, `/api/org/roles` writes. See `server/middleware/webOnly.ts`.

## Realtime and push baseline

- `asyncapi/aino-realtime.yaml` records the `/ws` handshake/authentication path, `{ type, data }` envelope, core chat/call commands and events, and the server's idempotency semantics.
- `schemas/push/*.schema.json` model the FCM data records emitted by `server/services/pushNotifications.ts` for incoming calls, call teardown, chat messages, and general alerts.
- `fixtures/push/*.json` are deterministic canonical examples. Incoming-call fixtures include both visible-caller and `hideSensitiveContent` variants.
- `tests/realtime-contracts.test.mjs` and `scripts/validate-realtime-contracts.mjs` use only Node built-ins. Run `node --test contracts/tests/*.test.mjs`, or use `npm run contracts:validate` to validate HTTP and realtime contracts together.

### Known coverage gaps

This is intentionally a baseline, not an exhaustive realtime specification. AsyncAPI currently omits detailed schemas for typing/read, WebRTC signal/reconnect/ready/subscribe/reaction, meetings/huddles, presence/status, and group-management events. In-app notifications (`notification`, `notifications_changed`) and the cross-device domain sync events (`task_assigned`, `task_updated`, `attendance_update`, `team_attendance_update`, `leave_update`, `leave_policy_changed`, `approval_update`) are modeled, including the relative `link` deep-link formats shared by the WS payload, `GET /api/notifications` rows and the FCM general alert (`link`, `linkTaskId`; sent only to device tokens registered with `pushVersion: 2`, because older Android apps reject unknown keys). Several documented server events retain open `data` objects because their exact payload varies by transition. Push schemas cover the server-built FCM `data` map, not provider-added metadata or every platform wrapper (`android`, `apns`, `webpush`). Only incoming-call push currently has a server-side `hideSensitiveContent` variant; message and general-alert builders do not consult that preference, so no unsupported privacy variant is asserted for them.
