# Chat module

Owns all **65** public `/api/chat` endpoints. As of 2026-09-02, no HTTP
endpoint registration remains in `server/routes/chat.ts`; that 11-line file
only composes the tenant/feature middleware and mounts the module's route
adapters.

## Migrated endpoints

- `POST /messages/:id/reactions`
- `POST /messages/:id/pin`
- `GET /conversations/:id/pinned`
- `POST /messages/:id/star`
- `GET /starred`
- `GET /blocked`
- `POST /users/:userId/block`
- `DELETE /users/:userId/block`
- `POST /conversations`
- `POST /conversations/group`
- `GET /conversations/:id/members`
- `POST /conversations/:id/pin`
- `POST /conversations/:id/favourite`
- `POST /conversations/:id/mute`
- `POST /conversations/:id/archive`
- `GET /ice-config`
- `GET /search`
- `GET /presence`
- `PUT /conversations/:id/group`
- `POST /conversations/:id/leave`
- `PUT /conversations/:id/participants/:userId/role`
- `POST /conversations/:id/transfer-owner`
- `GET /conversations/:id/invite-link`
- `PUT /conversations/:id/invite-link`
- `POST /conversations/:id/invite-link/reset`
- `GET /invite/:token`
- `POST /invite/:token/join`
- `DELETE /invite/:token/request`
- `GET /conversations/:id/join-requests`
- `POST /conversations/:id/join-requests/:userId/approve`
- `POST /conversations/:id/join-requests/:userId/deny`
- `POST /conversations/:id/avatar`
- `GET /conversations/:id/active-call`
- `GET /conversations`
- `GET /conversations/:id/messages`
- `POST /conversations/:id/read`
- `GET /conversations/:id/read-status`
- `POST /conversations/:id/messages`
- `POST /conversations/:id/files`
- `POST /media-jobs/:id/cancel`
- `POST /media-jobs/:id/retry`
- `PUT /messages/:id`
- `DELETE /messages/:id`
- `GET /search-messages`
- `POST /messages/:id/forward`
- `POST /conversations/:id/polls`
- `POST /polls/:id/vote`
- `GET /polls/:id`
- `GET /conversations/:id/files`
- `POST /conversations/:id/unread`
- `DELETE /conversations/:id/messages`
- `DELETE /conversations/:id`
- `POST /messages/:id/delivered`
- `POST /messages/:id/view`
- `GET /calls`
- `POST /calls/delete`
- `GET /calls/active`
- `GET /conversations/:id/calls`
- `GET /calls/:callId` (numeric ids only; other values fall through)
- `POST /calls/:callId/reject`
- `POST /calls/:callId/accept`
- `POST /calls/:callId/end`
- `POST /calls/cancel`
- `POST /calls/:callId/ringing`
- `GET /link-preview`

## Layers and boundaries

```text
chat.routes.ts -> chat.*.routes.ts -> chat.service.ts -> chat.repository.ts
```

- The composition router retains `requireTenant` and `requireFeature("chat")`;
  every module endpoint retains `auth` and any original middleware.
- Route adapters retain HTTP parsing, status/response mapping, and delivery
  side effects: WebSocket fan-out, Redis unread updates, media jobs, storage,
  push cancellation, and status updates.
- The service applies chat workflows and is the only route-to-database path.
- `chat.repository.ts` owns every SQL statement and does not import Express;
  the conversation-list query lives in `chat.conversation-list.repository.ts`.
- Group invite links, join requests, the group photo upload and the active
  group-call lookup live in `chat.group-invite.{routes,service,repository}.ts`.
  Links are tenant-scoped (each tenant has its own database) and joiners must
  be active users of the group's organization; `manage_invite` in
  `utils/groupPerms` gates link and request management (owner/admin).
- Clear chat / delete chat are **per user**: they set the requester's
  `conversation_participants.cleared_at` (and `hidden_at` for delete) and only
  the requester's sessions receive `chat_cleared` / `chat_conv_deleted`. Every
  user-facing message read joins the requester's participant row and filters
  `m.created_at > COALESCE(cp.cleared_at, '-infinity')`; the list also skips
  rows whose `hidden_at` is newer than the last visible message. Call history
  (`call_logs`) is intentionally not filtered.
- The ringing-phase call routes (`POST /calls/cancel`, `POST /calls/:callId/ringing`)
  share their logic with the WS `call_cancel` / `call_ringing` handlers via
  `utils/wsHandlers/callRinging.ts`.
- `chat.schema.ts` contains the shared parameter/body validation used by the
  extracted conversation and message actions; endpoint-specific validation
  remains unchanged at the HTTP boundary.

## Validation

- `modules/chat/__tests__/chat.module-composition.test.ts` pins all 65 method
  and path pairs and asserts that the legacy composition router registers none.
- `modules/chat/__tests__/chat.service.test.ts` covers existing service rules
  plus repository delegation for paginated and scoped searches.
- Run `npm test -- __tests__/chat.routes.test.ts modules/chat/__tests__/chat.service.test.ts modules/chat/__tests__/chat.module-composition.test.ts`,
  `npm run typecheck`, `npm run lint:deps`, and root
  `npm run check:guardrails`.
