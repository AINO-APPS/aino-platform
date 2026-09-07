/**
 * WebSocket server for real-time notifications and chat.
 * Attaches to the HTTP server and authenticates via the JWT cookie.
 *
 * STATUS / PRESENCE NOTE (status service v2):
 *   • Every WS connection registers a session with `statusService.openSession`
 *     and closes it on disconnect / pong-timeout via `statusService.closeSession`.
 *   • That is the canonical source of presence + per-device activity. The
 *     legacy `presence_change` / `status_change` events were removed in PR7;
 *     clients now subscribe to the unified `user_status` event broadcast by
 *     services/status/broadcaster.js.
 */
import { randomUUID } from "crypto";
import type { Server as HTTPServer } from "http";
import type { IncomingMessage } from "http";
import { logger } from "./logger";
import { handleChatMessage as dispatchMessage } from "../realtime/messageRouter";
import { INSTANCE_ID, broadcast, deliverLocal, notifyUser, sendToUser } from "../realtime/fanout";
import {
  DbLike,
  ExtWS,
  clients,
  clientKey,
  isConversationMember,
  isMeetingMember,
  emitCallHistoryMessage as sharedEmitCallHistoryMessage,
  scheduleMeetingDisconnectCleanup,
} from "./wsHandlers/shared";

async function emitCallHistoryMessage(
  db: DbLike,
  tenantId: number | null | undefined,
  conversationId: number,
  callerId: number,
  callType: string,
  status: "ended" | "missed" | "declined",
  duration: number | null,
): Promise<void> {
  return sharedEmitCallHistoryMessage(
    db, tenantId, conversationId, callerId, callType, status, duration, sendToUser,
  );
}

async function handleChatMessage(
  db: DbLike,
  senderId: number,
  tenantId: number | null,
  msg: any,
  ws: ExtWS,
): Promise<void> {
  return dispatchMessage(db, senderId, tenantId, msg, ws, sendToUser);
}
const { WebSocketServer } = require("ws");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");
const { masterQuery } = require("../db");
const { getTenantPool, getTenantById } = require("./tenantManager");
const redis = require("../redis");
const statusService = require("../services/status");
const wsMetrics = require("./wsMetrics");
import { pushNotifications } from "../services/pushNotifications";
import { validateSession } from "../services/authSessions";

// Phase 6 — Per-message default soft-timeout. Most handlers should complete
// in well under a second; if any handler hangs for > 5s it almost certainly
// represents a runaway DB query (deadlock, missing index) or an upstream
// service hang. Surface it as a timeout error in metrics so we can see
// which handler is the culprit without piling up open WS frames.
//
// 0 means "no timeout" — set per-handler below for the few that are
// allowed to be slow (notably the legacy /meeting_chat persist that we
// already harden with its own try/catch).
const WS_HANDLER_DEFAULT_TIMEOUT_MS = 5_000;

// How often (per socket) to re-validate the JWT's token_version against the
// live value while the socket is open. Closes sockets whose session was
// revoked (logout / forced sign-out / password change) or whose JWT expired.
const WS_AUTH_RECHECK_MS = 60_000;

/** Max WebSocket connections a single user may hold per server instance.
 *  Each browser tab uses ~4 WS connections (chat, calls, status, notifications)
 *  so allow enough for 2-3 tabs or a browser + desktop app. */
const MAX_CONNECTIONS_PER_USER = 12;

/** Unique instance ID for Pub/Sub dedup */

async function setupWebSocket(server: HTTPServer): Promise<any> {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 64 * 1024,
    verifyClient: (
      { req }: { req: IncomingMessage },
      done: (ok: boolean, code?: number, message?: string) => void,
    ) => {
      // Prevent Cross-Site WebSocket Hijacking (CSWSH)
      const origin = req.headers.origin;
      if (!origin) return done(true); // non-browser clients (Electron, curl) have no Origin

      const host = req.headers.host;
      if (host && (origin === `https://${host}` || origin === `http://${host}`))
        return done(true);

      // REBRAND (WorkPulse -> AINO): accept both desktop protocol origins so
      // installed builds keep their realtime socket while new builds use aino://.
      if (origin.startsWith("workpulse://") || origin.startsWith("aino://"))
        return done(true);

      if (process.env.CORS_ORIGIN) {
        const allowed = process.env.CORS_ORIGIN.split(",").map((s) => s.trim());
        if (allowed.includes(origin)) return done(true);
      }

      if (process.env.NODE_ENV !== "production") {
        const devOrigins = [
          "http://localhost:3000",
          "http://localhost:3001",
          "http://localhost:5173",
          "http://localhost:5000",
        ];
        if (devOrigins.includes(origin)) return done(true);
      }

      logger.warn({ origin }, "WebSocket connection rejected: invalid origin");
      done(false, 403, "Origin not allowed");
    },
  });

  // ── Redis Pub/Sub: subscribe to user message channels ──
  const sub = redis.getSubscriber();
  if (sub) {
    // bootstrap() has awaited Redis readiness. Await subscription too so the
    // realtime role never reports ready while cross-instance fan-out is dark.
    await sub.subscribe("ws:broadcast");
    logger.info("Redis subscribed to ws:broadcast");
    sub.on("message", (channel: string, raw: string) => {
      try {
        const envelope = JSON.parse(raw);
        if (envelope._from === INSTANCE_ID) return; // ignore own publishes
        if (channel === "ws:broadcast") {
          deliverLocal(
            envelope.tenantId,
            envelope.userId,
            envelope.type,
            envelope.data,
          );
        }
      } catch {
        /* ignore */
      }
    });
  }

  wss.on("connection", async (ws: ExtWS, req: IncomingMessage) => {
    // Authenticate via cookie (web/desktop) or, for native mobile clients
    // that can't send cookies on the WS handshake, via a `token` query
    // param or the `Sec-WebSocket-Protocol` header. Cookie takes precedence.
    const cookies = cookie.parse(req.headers.cookie || "");
    let token: string | undefined = cookies.token;
    if (!token) {
      try {
        const url = new URL(req.url || "", "http://localhost");
        token = url.searchParams.get("token") || undefined;
      } catch {
        /* malformed url — ignore */
      }
    }
    if (!token) {
      const proto = req.headers["sec-websocket-protocol"];
      if (typeof proto === "string" && proto.length > 0) {
        token = proto.split(",")[0].trim();
      }
    }
    if (!token) {
      ws.close(4001, "Unauthorized");
      return;
    }

    let payload: any;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      ws.close(4001, "Unauthorized");
      return;
    }

    // Verify token_version hasn't been revoked (password change/reset)
    const userId: number = payload.id;
    const tenantId: number | null = payload.tenant_id;

    // Resolve tenant DB
    let db: DbLike;
    if (tenantId) {
      try {
        const tenant = await getTenantById(tenantId);
        if (!tenant || tenant.status !== "active") {
          ws.close(4003, "Tenant unavailable");
          return;
        }
        const poolEntry = await getTenantPool(tenant.db_name, tenant.db_host);
        db = { query: poolEntry.query, transaction: poolEntry.transaction };
      } catch (e: any) {
        logger.warn({ err: e.message, tenantId }, "WS tenant pool failed");
        ws.close(4003, "Tenant unavailable");
        return;
      }
    } else {
      db = { query: masterQuery };
    }
    ws.db = db;
    ws.tenantId = tenantId || null;

    try {
      const tokenVersion = payload.tv ?? 0;
      if (!payload.sid || await validateSession(userId, payload.sid, db) !== "active") {
        ws.close(4001, "Session ended");
        return;
      }
      let dbTokenVersion = await redis.getTokenVersion(tenantId, userId);
      if (dbTokenVersion === null) {
        const userTable = payload.platform && !tenantId ? "platform_users" : "users";
        const userRow = (
          await db.query(`SELECT token_version FROM ${userTable} WHERE id = $1`, [
            userId,
          ])
        ).rows[0];
        if (!userRow) {
          ws.close(4001, "Token revoked");
          return;
        }
        dbTokenVersion = userRow.token_version || 0;
        await redis.setTokenVersion(tenantId, userId, dbTokenVersion);
      }
      if (tokenVersion !== dbTokenVersion) {
        ws.close(4001, "Token revoked");
        return;
      }
      // Stash the token version + JWT expiry so the message handler can
      // periodically re-validate. Without this, a socket opened before a
      // logout / forced-revoke / password change stays fully functional
      // forever because the token version is otherwise only checked once.
      ws._tokenVersion = tokenVersion;
      ws._sessionId = payload.sid;
      ws._tokenExpMs = payload.exp ? payload.exp * 1000 : null;
      ws._lastAuthCheckAt = Date.now();
    } catch {
      ws.close(4001, "Auth check failed");
      return;
    }

    // Register client (enforce per-user connection limit)
    const ck = clientKey(tenantId, userId);
    const wasOffline = !clients.has(ck) || clients.get(ck)!.size === 0;
    if (!clients.has(ck)) clients.set(ck, new Set<ExtWS>());
    const userConns = clients.get(ck)!;
    if (userConns.size >= MAX_CONNECTIONS_PER_USER) {
      ws.close(4029, "Too many connections");
      return;
    }
    userConns.add(ws);

    // Status service v2: register this connection as its own session so
    // per-device activity (in_call / in_meeting) and "Appear Offline" can
    // be tracked correctly. The session_key is a UUID generated per WS
    // connection and stashed on `ws` so the disconnect handler can close
    // exactly this row (instead of guessing which one to kill).
    ws._statusSessionKey = randomUUID();
    const deviceLabel = req.headers["user-agent"]
      ? String(req.headers["user-agent"]).slice(0, 80)
      : null;
    // openSession also re-resolves effective state, writes an audit row,
    // updates the cache, and broadcasts the unified `user_status` event.
    statusService
      .openSession(
        { db, tenantId },
        { userId, sessionKey: ws._statusSessionKey, deviceLabel },
      )
      .catch((err: any) => {
        logger.warn(
          { err: err.message, userId },
          "statusService.openSession failed",
        );
      });

    logger.debug(
      { userId, tenantId, sessionKey: ws._statusSessionKey },
      "WS client connected",
    );

    // Bump users.last_seen_at on first WS connect so legacy chat /
    // presence callers ('/api/chat/presence') still see the user as
    // online. The status service writes its own per-session
    // last_seen_at — this is only for the legacy chat-presence read.
    if (wasOffline) {
      redis.setPresence(tenantId, userId, redis.TTL.PRESENCE);
      db.query("UPDATE users SET last_seen_at = NOW() WHERE id = $1", [
        userId,
      ]).catch((err: any) =>
        logger.warn({ err: err.message, userId }, "last_seen_at bump failed"),
      );
    }

    ws.on("message", (raw: any) => {
      // Per-connection rate limiting: max 60 messages per second
      // (WebRTC ICE candidate trickling can burst during call setup)
      const now = Date.now();

      // Re-validate the session periodically (and on JWT expiry) so a
      // socket opened before a logout / forced-revoke / password change
      // is torn down instead of remaining fully functional. The check is
      // throttled and runs asynchronously so it never blocks message
      // dispatch; it fails open on transient Redis/DB errors.
      if (ws._tokenExpMs && now > ws._tokenExpMs) {
        ws.close(4001, "Token expired");
        return;
      }
      if (
        !ws._authCheckInFlight &&
        now - (ws._lastAuthCheckAt || 0) > WS_AUTH_RECHECK_MS
      ) {
        ws._lastAuthCheckAt = now;
        ws._authCheckInFlight = true;
        Promise.resolve()
          .then(async () => {
            if (!ws._sessionId || await validateSession(userId, ws._sessionId, db) !== "active") {
              ws.close(4001, "Session ended");
              return;
            }
            let dbTv = await redis.getTokenVersion(tenantId, userId);
            if (dbTv === null) {
              const userTable = payload.platform && !tenantId ? "platform_users" : "users";
              const row = (
                await db.query(
                  `SELECT token_version FROM ${userTable} WHERE id = $1`,
                  [userId],
                )
              ).rows[0];
              if (!row) {
                ws.close(4001, "Token revoked");
                return;
              }
              dbTv = row.token_version || 0;
              await redis.setTokenVersion(tenantId, userId, dbTv);
            }
            if ((ws._tokenVersion ?? 0) !== dbTv) {
              logger.debug(
                { userId, tenantId },
                "WS session revoked — closing socket",
              );
              ws.close(4001, "Session revoked");
            }
          })
          .catch(() => {
            /* fail open on transient error */
          })
          .finally(() => {
            ws._authCheckInFlight = false;
          });
      }

      if (!ws._rlWindow || now - ws._rlWindow > 1000) {
        ws._rlWindow = now;
        ws._rlCount = 0;
      }
      if (++ws._rlCount > 60) {
        logger.warn(
          { userId, tenantId, count: ws._rlCount },
          "WS rate limit exceeded, dropping message",
        );
        return;
      }

      try {
        const msg = JSON.parse(raw);
        // Application-level heartbeat: the client (web + desktop) sends
        // `{ type: 'ping' }` on a timer and arms a watchdog that closes
        // the socket if no frame comes back. Reply immediately with a
        // `pong` so a healthy-but-quiet connection isn't torn down.
        // Handled here (before the metrics-wrapped dispatch) so it stays
        // cheap and doesn't pollute the per-handler stats. We also treat
        // it as proof of life for the server-side pong heartbeat.
        if (msg && msg.type === "ping") {
          ws.isAlive = true;
          ws._missedPongs = 0;
          try {
            ws.send(JSON.stringify({ type: "pong" }));
          } catch {
            /* ignore */
          }
          return;
        }
        // Phase 6 — wrap every dispatch with the metrics collector so
        // /api/internal/ws-stats can show p50/p95 latency, count,
        // errors, and timeouts per message type. Timeout defaults to
        // 5s so a runaway DB query surfaces as a timeout error in
        // metrics instead of piling up open WS frames.
        wsMetrics
          .recordHandler(
            msg?.type || "unknown",
            WS_HANDLER_DEFAULT_TIMEOUT_MS,
            () => handleChatMessage(db, userId, tenantId, msg, ws),
          )
          .catch((err: any) => {
            logger.error(
              {
                err: err?.message,
                stack: err?.stack,
                userId,
                tenantId,
                type: msg?.type,
              },
              "WS message handler error",
            );
          });
      } catch {
        /* ignore non-JSON */
      }
    });

    ws.on("close", async () => {
      const set = clients.get(ck);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          clients.delete(ck);
          // Drop Redis presence + bump last_seen_at for legacy
          // /api/chat/presence readers. Status service emits the
          // canonical `user_status` event from closeSession() below.
          redis.removePresence(tenantId, userId);
          db.query("UPDATE users SET last_seen_at = NOW() WHERE id = $1", [
            userId,
          ]).catch((err: any) => {
            logger.warn(
              { err: err.message, userId },
              "Failed to update last_seen_at on disconnect",
            );
          });
        }
      }

      // Status service v2: close exactly this connection's session.
      // If it was the user's last open session, the service will
      // resolve them as offline and broadcast `user_status` accordingly.
      // closeSession also clears any per-session activity (in_call /
      // in_meeting) as part of the UPDATE — see repository.closeSession.
      if (ws._statusSessionKey) {
        statusService
          .closeSession({ db, tenantId }, ws._statusSessionKey)
          .catch((err: any) =>
            logger.warn(
              { err: err.message, userId },
              "statusService.closeSession failed",
            ),
          );
        ws._statusSessionKey = null;
        ws._callActivityRefId = null;
        ws._meetingActivityRefId = null;
      }

      // Clean up meeting if user was in one and didn't explicitly leave.
      // IMPORTANT: do NOT mark them as "left" immediately — schedule a
      // grace window so the user's auto-reconnecting WebSocket can
      // re-join silently without ejecting them from the meeting and
      // tearing down the other participants' RTCPeerConnections.
      if (ws._activeMeetingId) {
        const mid = ws._activeMeetingId;
        ws._activeMeetingId = null;
        try {
          await scheduleMeetingDisconnectCleanup({
            db,
            tenantId,
            userId,
            meetingId: mid,
            sendToUser,
          });
        } catch (err: any) {
          // In production Redis loss is already process-fatal. Log this frame
          // explicitly so the meeting state risk is visible before restart.
          logger.error(
            { err: err.message, tenantId, userId, meetingId: mid },
            "Failed to schedule distributed meeting disconnect cleanup",
          );
        }
      }

      logger.debug({ userId, tenantId }, "WS client disconnected");
    });

    ws.on("error", (err: any) => {
      logger.warn({ err: err?.message, userId }, "WebSocket error");
      ws.close();
    });

    // Heartbeat: keep connection alive
    ws.isAlive = true;
    ws.userId = userId;
    ws.tenantId = tenantId || null;
    ws.on("pong", () => {
      ws.isAlive = true;
      // Refresh Redis presence TTL on every pong so users don't appear offline
      redis.setPresence(ws.tenantId, ws.userId, redis.TTL.PRESENCE);
      // Status service v2: keep this session's last_seen_at fresh so
      // the resolver doesn't classify it as stale (> SESSION_STALE_MS).
      if (ws._statusSessionKey) {
        statusService
          .touchSession({ db, tenantId: ws.tenantId }, ws._statusSessionKey)
          .catch(() => {
            /* best-effort */
          });
      }
    });
  });

  // Heartbeat interval — softer than before: a single missed pong no longer
  // terminates the socket. We only kill the connection after `MAX_MISSED_PONGS`
  // consecutive missed pings (~60s of silence), which matches videosdk-style
  // SDK behaviour and prevents brief network blips from kicking users out of
  // their meeting. Combined with `scheduleMeetingDisconnectCleanup` below,
  // a short Wi-Fi drop now causes zero user-visible disruption.
  const MAX_MISSED_PONGS = 2;
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws: ExtWS) => {
      ws._missedPongs = (ws._missedPongs || 0) + (ws.isAlive ? 0 : 1);
      if (ws._missedPongs > MAX_MISSED_PONGS) {
        logger.debug(
          { userId: ws.userId, missed: ws._missedPongs },
          "WS terminating after missed pongs",
        );
        return ws.terminate();
      }
      ws.isAlive = false;
      if (ws.userId && ws._sessionId && ws.db && !ws._heartbeatAuthCheckInFlight) {
        ws._heartbeatAuthCheckInFlight = true;
        validateSession(ws.userId, ws._sessionId, ws.db)
          .then((state) => {
            if (state !== "active") ws.close(4001, "Session ended");
          })
          .catch(() => {
            /* fail open on transient DB errors */
          })
          .finally(() => {
            ws._heartbeatAuthCheckInFlight = false;
          });
      }
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    });
  }, 30000);

  wss.on("close", () => clearInterval(heartbeat));

  return wss;
}


export {
  setupWebSocket,
  sendToUser,
  broadcast,
  notifyUser,
  handleChatMessage,
  isConversationMember,
  isMeetingMember,
  emitCallHistoryMessage,
};
