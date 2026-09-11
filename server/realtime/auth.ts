import type { IncomingMessage } from "http";
import * as cookie from "cookie";
import jwt from "jsonwebtoken";
import type { DbLike, ExtWS } from "./types";
import { TENANT_COOKIE } from "../utils/cookie";
import { PLATFORM_REALM } from "../platform/realm";

export interface RealtimeClaims {
  id: number;
  tenant_id: number | null;
  sid?: string;
  tv?: number;
  exp?: number;
  platform?: boolean;
  aud?: string | string[];
  [key: string]: unknown;
}

function resolveRealtimeToken(req: IncomingMessage): string | undefined {
  // Tenant realm only — realtime (chat/presence/calls) is a product feature and
  // the control plane has no WebSocket surface. Deliberately reads the tenant
  // cookie and never `aino_console`.
  const cookies = cookie.parse(req.headers.cookie || "");
  if (cookies[TENANT_COOKIE]) return cookies[TENANT_COOKIE];
  try {
    const queryToken = new URL(req.url || "", "http://localhost").searchParams.get("token");
    if (queryToken) return queryToken;
  } catch {
    // Malformed URLs are treated as having no query token.
  }
  const protocol = req.headers["sec-websocket-protocol"];
  return typeof protocol === "string" && protocol.length > 0
    ? protocol.split(",")[0].trim() || undefined
    : undefined;
}

function verifyRealtimeToken(token: string, secret: string | undefined): RealtimeClaims {
  if (!secret) throw new Error("JWT_SECRET is required");
  const claims = jwt.verify(token, secret) as unknown as RealtimeClaims;
  // A control-plane token must never open a product socket. Realmless
  // (pre-PR-B) tokens are tenant tokens and remain accepted during the grace
  // window; only an explicit platform `aud` is rejected.
  const aud = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
  if (aud === PLATFORM_REALM) {
    throw new Error("Platform-realm token cannot open a realtime connection");
  }
  return claims;
}

async function revalidateSocketSession(
  ws: ExtWS,
  validateSession: (userId: number, sessionId: string, db: DbLike) => Promise<string>,
): Promise<void> {
  if (!ws.userId || !ws._sessionId || !ws.db || ws._heartbeatAuthCheckInFlight) return;
  ws._heartbeatAuthCheckInFlight = true;
  try {
    if (await validateSession(ws.userId, ws._sessionId, ws.db) !== "active") {
      ws.close(4001, "Session ended");
    }
  } catch {
    // Fail open on transient DB errors, preserving the existing availability policy.
  } finally {
    ws._heartbeatAuthCheckInFlight = false;
  }
}

export { resolveRealtimeToken, verifyRealtimeToken, revalidateSocketSession };
