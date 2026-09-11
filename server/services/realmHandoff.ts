import crypto from "crypto";
import jwt from "jsonwebtoken";
import { masterQuery } from "../db";
import type { Realm } from "../platform/realm";

const HANDOFF_TTL_SECONDS = 30;
const LOGIN_CHOICE_TTL_SECONDS = 60;

function jwtSecret(): string {
    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");
    return process.env.JWT_SECRET;
}

interface HandoffClaims {
    jti: string;
    source_realm: "tenant" | "platform" | "login";
    target_realm: Realm;
    platform_user_id: number;
    tenant_id: number;
    tenant_user_id: number;
}

async function createHandoff(claims: Omit<HandoffClaims, "jti">): Promise<string> {
    const jti = crypto.randomUUID();
    await masterQuery(
        `INSERT INTO realm_handoffs
            (jti, source_realm, target_realm, platform_user_id, tenant_id, tenant_user_id, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW() + INTERVAL '30 seconds')`,
        [jti, claims.source_realm, claims.target_realm, claims.platform_user_id,
            claims.tenant_id, claims.tenant_user_id],
    );
    return jwt.sign({ ...claims, jti }, jwtSecret(), {
        audience: "realm-handoff",
        expiresIn: `${HANDOFF_TTL_SECONDS}s`,
    });
}

/** Atomically consume once. A replay, expiry, or claim mismatch returns null. */
async function consumeHandoff(token: string, expectedTarget?: Realm): Promise<HandoffClaims | null> {
    let claims: any;
    try {
        claims = jwt.verify(token, jwtSecret(), { audience: "realm-handoff" });
    } catch {
        return null;
    }
    // Reject before the UPDATE so presenting a valid ticket to the wrong host
    // cannot burn it and deny the legitimate switch.
    if (expectedTarget && claims.target_realm !== expectedTarget) return null;
    const result = await masterQuery(
        `UPDATE realm_handoffs SET consumed_at = NOW()
          WHERE jti = $1 AND consumed_at IS NULL AND expires_at > NOW()
            AND source_realm = $2 AND target_realm = $3
            AND platform_user_id = $4 AND tenant_id = $5 AND tenant_user_id = $6
          RETURNING jti`,
        [claims.jti, claims.source_realm, claims.target_realm, claims.platform_user_id,
            claims.tenant_id, claims.tenant_user_id],
    );
    return result.rows[0] ? claims as HandoffClaims : null;
}

interface LoginChoiceClaims {
    jti: string;
    platform_user_id: number;
    tenant_id: number;
    tenant_user_id: number;
}

async function createLoginChoice(claims: Omit<LoginChoiceClaims, "jti">): Promise<string> {
    const jti = crypto.randomUUID();
    await masterQuery(
        `INSERT INTO realm_login_choices
            (jti, platform_user_id, tenant_id, tenant_user_id, expires_at)
         VALUES ($1,$2,$3,$4,NOW() + INTERVAL '60 seconds')`,
        [jti, claims.platform_user_id, claims.tenant_id, claims.tenant_user_id],
    );
    return jwt.sign({ ...claims, jti }, jwtSecret(), {
        audience: "realm-choice",
        expiresIn: `${LOGIN_CHOICE_TTL_SECONDS}s`,
    });
}

async function consumeLoginChoice(token: string): Promise<LoginChoiceClaims | null> {
    let claims: any;
    try {
        claims = jwt.verify(token, jwtSecret(), { audience: "realm-choice" });
    } catch {
        return null;
    }
    const result = await masterQuery(
        `UPDATE realm_login_choices SET consumed_at = NOW()
          WHERE jti = $1 AND consumed_at IS NULL AND expires_at > NOW()
            AND platform_user_id = $2 AND tenant_id = $3 AND tenant_user_id = $4
          RETURNING jti`,
        [claims.jti, claims.platform_user_id, claims.tenant_id, claims.tenant_user_id],
    );
    return result.rows[0] ? claims as LoginChoiceClaims : null;
}

export {
    HANDOFF_TTL_SECONDS, LOGIN_CHOICE_TTL_SECONDS,
    createHandoff, consumeHandoff, createLoginChoice, consumeLoginChoice,
};