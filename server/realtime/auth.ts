import type { IncomingMessage } from "http";
import * as cookie from "cookie";
import jwt from "jsonwebtoken";
import type { DbLike, ExtWS } from "./types";

export interface RealtimeClaims {
  id: number;
  tenant_id: number | null;
  sid?: string;
  tv?: number;
  exp?: number;
  platform?: boolean;
  [key: string]: unknown;
}

function resolveRealtimeToken(req: IncomingMessage): string | undefined {
  const cookies = cookie.parse(req.headers.cookie || "");
  if (cookies.token) return cookies.token;
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
  return jwt.verify(token, secret) as unknown as RealtimeClaims;
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
