import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from "crypto";
const { authenticator } = require("otplib");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

/**
 * TOTP MFA for administrators (P2.1). Applies to tenant users at `hr_admin`
 * level or above and to platform operators, on web and desktop (the native
 * apps have no admin surface: middleware/webOnly.ts).
 *
 * - Secrets are AES-256-GCM encrypted with a key derived from `MFA_ENC_KEY`
 *   (falls back to `JWT_SECRET`), stored in `mfa_secret`.
 * - Sign-in: password OK + MFA on → `MFA_REQUIRED` + a 5-minute ticket; the
 *   session is only created after `POST /auth/mfa/verify`.
 * - Admins without MFA are asked to enrol at sign-in (`MFA_ENROLL_REQUIRED`).
 * - Step-up: destructive admin routes need a code verified within
 *   [STEP_UP_WINDOW_SECONDS] (`mfa_at` claim on the session token).
 */
export const MFA_ADMIN_LEVEL = 4; // hr_admin
export const STEP_UP_WINDOW_SECONDS = 10 * 60;
const TICKET_TTL_SECONDS = 5 * 60;
const RECOVERY_CODE_COUNT = 10;
const ISSUER = "AINO";

authenticator.options = { window: 1, step: 30, digits: 6 };

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
interface DbLike { query: Query; }

function key(): Buffer {
    const source = process.env.MFA_ENC_KEY || process.env.JWT_SECRET;
    if (!source) throw new Error("MFA_ENC_KEY or JWT_SECRET is required");
    return createHash("sha256").update(`aino-mfa:${source}`).digest();
}

export function encryptSecret(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key(), iv);
    const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decryptSecret(stored: string): string {
    const [version, iv, tag, body] = String(stored).split(".");
    if (version !== "v1" || !iv || !tag || !body) throw new Error("Unsupported MFA secret format");
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}

/** True when the role level must use MFA. */
export function mfaRequiredForLevel(level: number | null | undefined, isPlatformUser = false): boolean {
    return isPlatformUser || Number(level || 0) >= MFA_ADMIN_LEVEL;
}

/** Normalize a typed code: digits only for TOTP, uppercase for recovery codes. */
const clean = (code: unknown) => String(code ?? "").replace(/[\s-]/g, "");

export function verifyTotp(secret: string, code: unknown): boolean {
    const digits = clean(code);
    return /^\d{6}$/.test(digits) && authenticator.check(digits, secret);
}

export function newRecoveryCodes(): string[] {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
        const raw = Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join("");
        return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
}

/** The table that holds this principal's MFA columns. */
const table = (isPlatformUser: boolean) => (isPlatformUser ? "platform_users" : "users");

export async function readMfaState(db: DbLike, userId: number, isPlatformUser: boolean): Promise<{ enabled: boolean; secret: string | null; pending: string | null; recovery: string[] }> {
    const row = (await db.query(
        `SELECT mfa_enabled, mfa_secret, mfa_pending_secret, mfa_recovery_codes FROM ${table(isPlatformUser)} WHERE id = $1`,
        [userId],
    )).rows[0] || {};
    return {
        enabled: !!row.mfa_enabled && !!row.mfa_secret,
        secret: row.mfa_secret || null,
        pending: row.mfa_pending_secret || null,
        recovery: Array.isArray(row.mfa_recovery_codes) ? row.mfa_recovery_codes : [],
    };
}

/** Start enrolment: a new pending secret and its `otpauth://` URI. */
export async function beginEnrollment(db: DbLike, userId: number, isPlatformUser: boolean, account: string): Promise<{ secret: string; otpauthUrl: string }> {
    const secret = authenticator.generateSecret(20);
    await db.query(`UPDATE ${table(isPlatformUser)} SET mfa_pending_secret = $1 WHERE id = $2`, [encryptSecret(secret), userId]);
    return { secret, otpauthUrl: authenticator.keyuri(account, ISSUER, secret) };
}

/** Finish enrolment with a code from the app; returns the one-time recovery codes. */
export async function confirmEnrollment(db: DbLike, userId: number, isPlatformUser: boolean, code: unknown): Promise<string[] | null> {
    const state = await readMfaState(db, userId, isPlatformUser);
    if (!state.pending || !verifyTotp(decryptSecret(state.pending), code)) return null;
    const codes = newRecoveryCodes();
    const hashes = await Promise.all(codes.map((c) => bcrypt.hash(c.replace("-", ""), 10)));
    await db.query(
        `UPDATE ${table(isPlatformUser)}
            SET mfa_secret = mfa_pending_secret, mfa_pending_secret = NULL, mfa_enabled = TRUE,
                mfa_enrolled_at = NOW(), mfa_recovery_codes = $1::jsonb
          WHERE id = $2`,
        [JSON.stringify(hashes), userId],
    );
    return codes;
}

/** Check a TOTP code, or consume a recovery code. */
export async function verifySecondFactor(db: DbLike, userId: number, isPlatformUser: boolean, code: unknown): Promise<"totp" | "recovery" | null> {
    const state = await readMfaState(db, userId, isPlatformUser);
    if (!state.enabled || !state.secret) return null;
    if (verifyTotp(decryptSecret(state.secret), code)) return "totp";
    const candidate = clean(code).toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(candidate)) return null;
    for (let i = 0; i < state.recovery.length; i++) {
        if (await bcrypt.compare(candidate, state.recovery[i])) {
            const remaining = state.recovery.filter((_, index) => index !== i);
            await db.query(`UPDATE ${table(isPlatformUser)} SET mfa_recovery_codes = $1::jsonb WHERE id = $2`, [JSON.stringify(remaining), userId]);
            return "recovery";
        }
    }
    return null;
}

export async function disableMfa(db: DbLike, userId: number, isPlatformUser: boolean): Promise<void> {
    await db.query(
        `UPDATE ${table(isPlatformUser)} SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_pending_secret = NULL, mfa_recovery_codes = NULL, mfa_enrolled_at = NULL WHERE id = $1`,
        [userId],
    );
}

/** Short-lived ticket proving the password step for one principal (`purpose`: verify or enroll). */
export interface MfaTicket { uid: number; tid: number | null; plat: boolean; purpose: "verify" | "enroll"; }

export function signMfaTicket(ticket: MfaTicket): string {
    return jwt.sign({ ...ticket, typ: "mfa" }, process.env.JWT_SECRET, { expiresIn: TICKET_TTL_SECONDS });
}

export function readMfaTicket(token: unknown): MfaTicket | null {
    try {
        const claims = jwt.verify(String(token || ""), process.env.JWT_SECRET);
        if (claims?.typ !== "mfa" || !Number.isInteger(claims.uid)) return null;
        return { uid: claims.uid, tid: claims.tid ?? null, plat: !!claims.plat, purpose: claims.purpose === "enroll" ? "enroll" : "verify" };
    } catch {
        return null;
    }
}

/** True when the session token proves a second factor within the step-up window. */
export function hasRecentStepUp(mfaAt: unknown, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
    const at = Number(mfaAt || 0);
    return at > 0 && nowSeconds - at <= STEP_UP_WINDOW_SECONDS;
}
