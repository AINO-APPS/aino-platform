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

Validate with `npm run contracts:validate` from the repository root. Model
checks/generation in npm scripts use `--platform-only`: they never rewrite or
require generated files in a native sibling checkout.
Contract test files run serially: generator/validator negative tests temporarily
mutate shared contract inputs and restore them. Parallel files could read the
temporary missing-field schema and fail fixture validation nondeterministically.

### Client-version observation and upgrade readiness

`client-versions.mjs` defines public `GET /api/client-versions` (OFF/REPORT and
three semantic minimums), tenantless platform-admin `GET /api/admin/client-versions`
(distinct users by class/version over authenticated last-seen in 30 days), the
shared `X-AINO-Client` / `X-AINO-Client-Version` parameters, and the future
`ClientUpgradeRequired` 426 model. Ticket 09 never returns 426 or enables
enforcement; compatibility operations remain in the inventory. Generated web
models include these contracts; generation remains platform-only. Operational
defaults, migration and release boundaries are in [the operator guide](../docs/client-versions.md).

### Manual worklogs and estimates

`GET /api/tasks/:id/worklogs` is read-only and returns author/logged-by identities,
day worked, minutes, optional start/comment, timestamps, and computed
`time_spent_minutes`. Entries are newest day worked first, then creation time/id.
Ticket reads expose `time_spent_minutes`; the legacy `logged_minutes` alias and
`estimated_minutes` alias are retired. Timer endpoints are retired; record time
through manual worklogs instead.

`POST /api/tasks/:id/worklogs` takes day worked, time spent in org-aware w/d/h/m
format, optional start time, comment and an org-admin `author_id`. It returns 201
with `{ worklog, ticket, warnings }`; approved leave and excess attendance produce
advisory `ON_LEAVE` / `EXCEEDS_ATTENDANCE` warnings after saving. Invalid duration returns 400
`INVALID_DURATION`; Cancelled returns 403 `WORKLOG_CANCELLED`, while Done allows
logging. Server capabilities control the web/desktop and Android Log work,
estimate and person controls, plus edit/delete on each worklog.
`PATCH` / `DELETE /api/tasks/:id/worklogs/:worklogId` correct or soft-delete work.
All three worklog writes accept `remaining_mode`: `auto` (default, duration delta),
`set` (requires `remaining_estimate`), or `leave`. `PATCH /api/tasks/:id/estimates`
sets or clears original/remaining estimates; original seeds null remaining when
remaining is omitted. History and audit commit atomically and realtime follows
commit. Worklogs remain supported independently of the retired ticket timer.

`worklogs.mjs` defines the new field-level contract. `reviewed-task-baseline.json`
preserves already-published precise task, project and Service Desk schemas/operations when regenerating
with the historical baseline generator; unrelated contracts must not regress.

Android is inspected read-only. The native checker validates its committed
snapshot; the platform delta gate additionally checks **this checkout's** current
inventory against native coverage and waivers. All five manual-worklog/estimate
operations require actual native coverage, even if already in its snapshot;
none can be excused by a waiver. The temporary manual-worklog waivers are removed.
Unrelated existing pending/unmatched routes remain reported as baseline debt.
The tasks-parity time-tracking entry ships on web/desktop and Android with RTL
and public ticket-view-model behavioral owners:

```powershell
node scripts\check-android-endpoint-parity.mjs <Android-checkout>
```

No Android snapshots or source files are rewritten by this command.

### Project ownership (Phase 2)

Android ticket13 ships project-scoped Plan/create, move preview/confirm,
server-capability actions and current/alias key lookup. The matrix names its
`ProjectOwnershipViewModelTest` behavioral owners. Settings, member/workflow
administration, key rename and migration publication remain web-only; their
waivers are intentional, not pending native work.

For split worktrees, explicitly select the **integrated** Android checkout,
not a dirty main or an unrelated sibling branch:

```powershell
$env:AINO_ANDROID_REPO = '<Android-integration-checkout>'
node scripts\validate-tasks-parity.mjs
node scripts\check-android-endpoint-parity.mjs $env:AINO_ANDROID_REPO --projects-only
node "$env:AINO_ANDROID_REPO\scripts\check-realtime-parity.mjs" .
```

The explicit owner-root fails if unavailable instead of silently skipping native
tests. `--projects-only` proves eight required project-facing operations from
the native scanner's committed source coverage and refuses rollout waivers.
It is a **focused** check, not a substitute for the unfiltered endpoint gate
above; that gate still requires the separate manual-worklogs rollout. Realtime
includes the payload-free `project_updated` invalidation, routed by Android to
Tasks refetch, and the existing `task_updated` invalidation after moves.
The native realtime script may refresh its own snapshot when emitters change;
run it on a clean disposable checkout and inspect the resulting diff.

On Windows a native snapshot check can fail solely because `core.autocrlf`
checked out generated JSON/Markdown as CRLF. Validate an LF checkout
(`git -c core.autocrlf=false worktree add --detach ... <integration-ref>`) rather
than rewriting another worktree. Record focused and unfiltered results separately.

The mobile map covers backend calls made through the shared Axios `api` instance. Direct external `fetch` calls (for application updates, GitHub releases, and geocoding) are intentionally excluded because they are not AINO server routes. Validation fails if any wrapper call could not be resolved to a string or template-literal path.

## Scope and limitations

`coverage: "operation"` means the method/path, authentication alternatives, mutating-request CSRF header, common errors, parameters, and response envelope are represented in OpenAPI. It does **not** claim every endpoint payload is exhaustively modeled. The most bootstrap-critical schemas (login, registration, auth response, profile, health, device token, clock events, and presence) have initial field-level schemas. Other baseline operations intentionally use `FreeFormValue` until their handlers and tests are converted into precise reusable schemas. Routers marked `inventory-only` are tracked but not yet described as OpenAPI operations.

The seven notification operations are fully modeled from their handler and database schema, including pagination, integer path IDs, bounded metric-event batches, delivery metrics, announcements, and mutation acknowledgements. Contract validation rejects any notification operation that regresses to `FreeFormValue`.

The global search operation is fully modeled across its seven result groups. Missing or short queries use the same stable empty-array envelope as successful searches, and contract validation rejects a regression to `FreeFormValue`.

Project workflow operations are modeled for project-scoped state and transition management. The organization workflow-state read accepts an optional `project_id` and its writes return `405`, because organization states are now read-only templates.

`GET /api/tracker/status` is modeled as `TrackerStatus`. Its `floorSeconds` / `breakSeconds` integers are the exact worked/break seconds at response time (`floorMinutes === floor(floorSeconds / 60)`); contract validation requires both fields because native and web live timers anchor on them.

The server accepts either the `token` HttpOnly cookie or `Authorization: Bearer <jwt>` (cookie wins). Native clients use bearer authentication. Every mutating `/api` request except external webhooks must send `X-Requested-With: AINO` (the legacy `WorkPulse` value is also accepted). Tenant context is resolved from the verified JWT first, then from the request host/custom domain.

Administration is web-only (2026-10-01). Admin routes answer `403 { code: "WEB_ONLY" }` to native-app requests: a bearer-authenticated request, a token minted for the app (`cli: "mobile"` claim, stamped when the client sends `X-AINO-Client: android` or refreshes over bearer), or a request carrying `X-AINO-Client: android`. Gated: `/api/admin/**`, `/api/platform-access`, `/api/internal`, `/api/compensation` except `/my-*`, `/api/branding` except `GET /`, `/api/projects` writes, agile editor/reviewer routes, and `PUT /api/org/settings`, `POST /api/org/invite`, `POST /api/org/remove-member`, `/api/org/roles` writes. See `server/middleware/webOnly.ts`.

## Realtime and push baseline

- `asyncapi/aino-realtime.yaml` records the `/ws` handshake/authentication path, `{ type, data }` envelope, core chat/call commands and events, and the server's idempotency semantics.
- `schemas/push/*.schema.json` model the FCM data records emitted by `server/services/pushNotifications.ts` for incoming calls, call teardown, chat messages, and general alerts.
- `fixtures/push/*.json` are deterministic canonical examples. Incoming-call fixtures include both visible-caller and `hideSensitiveContent` variants.
- `tests/realtime-contracts.test.mjs` and `scripts/validate-realtime-contracts.mjs` use only Node built-ins. Run `node --test contracts/tests/*.test.mjs`, or use `npm run contracts:validate` to validate HTTP and realtime contracts together.

### Known coverage gaps

Group message avatar metadata is capability-gated to **Android pushVersion 4+**
only; Android v1–3, iOS and web retain the exact legacy message key set. Optional
`groupAvatar` is an intact URL or empty string. `groupMemberPreviews` is a
stringified JSON array of at most four strict `{name, avatar}` objects (string/null),
photo-first then ascending user ID, matching the conversation list. Names are
limited to 200 characters. Runtime validators additionally enforce UTF-8 limits:
2048 bytes per metadata field and 3800 bytes for the complete serialized data map.
The schema's string `maxLength` is a character bound, not a replacement for those
byte checks. `chat-message.group-v4.json` and the unchanged legacy fixture cover both
variants. Oversized metadata is omitted intact and logged; native Android fills
missing metadata through its account-scoped cache/authenticated conversation list.
General-alert v2 links and v3 reaction capability remain unchanged.

This is intentionally a baseline, not an exhaustive realtime specification. AsyncAPI currently omits detailed schemas for typing/read, WebRTC signal/reconnect/ready/subscribe/reaction, meetings/huddles, presence/status, and group-management events. In-app notifications (`notification`, `notifications_changed`) and the cross-device domain sync events (`task_assigned`, `task_updated`, `attendance_update`, `team_attendance_update`, `leave_update`, `leave_policy_changed`, `approval_update`) are modeled, including the relative `link` deep-link formats shared by the WS payload, `GET /api/notifications` rows and the FCM general alert (`link`, `linkTaskId`; sent only to device tokens registered with `pushVersion: 2`, because older Android apps reject unknown keys). Several documented server events retain open `data` objects because their exact payload varies by transition. Push schemas cover the server-built FCM `data` map, not provider-added metadata or every platform wrapper (`android`, `apns`, `webpush`). Only incoming-call push currently has a server-side `hideSensitiveContent` variant; message and general-alert builders do not consult that preference, so no unsupported privacy variant is asserted for them.
