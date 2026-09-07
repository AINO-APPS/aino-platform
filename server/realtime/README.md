# Realtime platform boundary

MIG-0514 owns the server transport and cross-instance realtime infrastructure.

- `auth.ts` resolves cookie, query and subprotocol credentials and revalidates sessions.
- `registry.ts` owns the process-local, tenant-qualified connection registry.
- `fanout.ts` delivers locally and publishes cross-instance envelopes through Redis.
- `heartbeat.ts` owns ping/pong liveness and heartbeat-time session checks.
- `messageRouter.ts` dispatches bounded chat, call and meeting handlers.
- `collaborationAuth.ts` and `collaborationServer.ts` own the `/collab` boundary.
- `signalStore.ts`, `meetingLeaveStore.ts` and `membershipCache.ts` own distributed state.
- `composition.ts` injects fan-out into status broadcasting without a status/transport cycle.

`server/utils/ws.ts` remains a compatibility facade and the `/ws` connection lifecycle adapter.
New consumers should import fan-out from `realtime/fanout`; only process-role composition should
start the transport. Wire event names and payloads remain governed by
`contracts/asyncapi/aino-realtime.yaml` and `scripts/validate-realtime-contracts.mjs`.
