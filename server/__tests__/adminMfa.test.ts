export {};

const { authenticator } = require("otplib");
const jwt = require("jsonwebtoken");
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const {
    encryptSecret, decryptSecret, mfaRequiredForLevel, verifyTotp, beginEnrollment, confirmEnrollment,
    verifySecondFactor, signMfaTicket, readMfaTicket, hasRecentStepUp, STEP_UP_WINDOW_SECONDS,
} = require("../services/adminMfa");
const { requireRecentMfa, reissueWithStepUp } = require("../middleware/requireRecentMfa");

/** One users row, mutated by the SQL the service sends. */
function userTable() {
    const row: Record<string, any> = { mfa_enabled: false, mfa_secret: null, mfa_pending_secret: null, mfa_recovery_codes: null };
    const query = jest.fn(async (sql: string, params: any[]) => {
        if (sql.startsWith("SELECT mfa_enabled")) return { rows: [row], rowCount: 1 };
        if (sql.includes("SET mfa_pending_secret = $1")) { row.mfa_pending_secret = params[0]; return { rows: [], rowCount: 1 }; }
        if (sql.includes("SET mfa_secret = mfa_pending_secret")) {
            Object.assign(row, { mfa_secret: row.mfa_pending_secret, mfa_pending_secret: null, mfa_enabled: true, mfa_recovery_codes: JSON.parse(params[0]) });
            return { rows: [], rowCount: 1 };
        }
        if (sql.includes("SET mfa_recovery_codes = $1")) { row.mfa_recovery_codes = JSON.parse(params[0]); return { rows: [], rowCount: 1 }; }
        throw new Error(`unexpected SQL: ${sql}`);
    });
    return { query, row };
}

describe("admin MFA", () => {
    test("applies to hr_admin and above, and to platform operators", () => {
        expect(mfaRequiredForLevel(3)).toBe(false);
        expect(mfaRequiredForLevel(4)).toBe(true);
        expect(mfaRequiredForLevel(5)).toBe(true);
        expect(mfaRequiredForLevel(1, true)).toBe(true);
    });

    test("keeps secrets encrypted at rest", () => {
        const stored = encryptSecret("JBSWY3DPEHPK3PXP");
        expect(stored).not.toContain("JBSWY3DPEHPK3PXP");
        expect(decryptSecret(stored)).toBe("JBSWY3DPEHPK3PXP");
        const tampered = stored.slice(0, -4) + "AAAA";
        expect(() => decryptSecret(tampered)).toThrow();
    });

    test("enrols with a code from the app and returns one-time recovery codes", async () => {
        const db = userTable();
        const { secret, otpauthUrl } = await beginEnrollment(db, 7, false, "ana@example.test");
        expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\/AINO:ana%40example\.test\?secret=/);
        expect(db.row.mfa_pending_secret).not.toContain(secret);

        expect(await confirmEnrollment(db, 7, false, "000000")).toBeNull();
        const codes = await confirmEnrollment(db, 7, false, authenticator.generate(secret));
        expect(codes).toHaveLength(10);
        expect(db.row.mfa_enabled).toBe(true);
        expect(JSON.stringify(db.row.mfa_recovery_codes)).not.toContain(codes[0].replace("-", ""));

        expect(await verifySecondFactor(db, 7, false, authenticator.generate(secret))).toBe("totp");
        expect(await verifySecondFactor(db, 7, false, codes[0])).toBe("recovery");
        // A recovery code works once.
        expect(await verifySecondFactor(db, 7, false, codes[0])).toBeNull();
        expect(db.row.mfa_recovery_codes).toHaveLength(9);
        expect(await verifySecondFactor(db, 7, false, "123")).toBeNull();
    });

    test("rejects malformed codes", () => {
        const secret = authenticator.generateSecret(20);
        expect(verifyTotp(secret, "abcdef")).toBe(false);
        expect(verifyTotp(secret, authenticator.generate(secret))).toBe(true);
        expect(verifyTotp(secret, ` ${authenticator.generate(secret).slice(0, 3)} ${authenticator.generate(secret).slice(3)} `)).toBe(true);
    });

    test("sign-in tickets are short-lived and purpose-bound", () => {
        const ticket = signMfaTicket({ uid: 7, tid: 3, plat: false, purpose: "verify" });
        expect(readMfaTicket(ticket)).toEqual({ uid: 7, tid: 3, plat: false, purpose: "verify" });
        // A session token is never accepted as a ticket.
        expect(readMfaTicket(jwt.sign({ id: 7 }, process.env.JWT_SECRET))).toBeNull();
        const { exp, iat } = jwt.decode(ticket);
        expect(exp - iat).toBe(300);
    });

    test("step-up proof expires after the window", () => {
        const now = 1_000_000;
        expect(hasRecentStepUp(now - 60, now)).toBe(true);
        expect(hasRecentStepUp(now - STEP_UP_WINDOW_SECONDS - 1, now)).toBe(false);
        expect(hasRecentStepUp(undefined, now)).toBe(false);
    });

    test("admin changes need a recent second factor; reads and impersonation do not", () => {
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
        const next = jest.fn();
        const stale = { method: "DELETE", decodedToken: { id: 1, mfa_at: Math.floor(Date.now() / 1000) - 3600 } };
        requireRecentMfa(stale, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json.mock.calls[0][0].code).toBe("MFA_STEP_UP_REQUIRED");

        requireRecentMfa({ method: "PUT", decodedToken: { id: 1, mfa_at: Math.floor(Date.now() / 1000) } }, res, next);
        requireRecentMfa({ method: "GET", decodedToken: { id: 1 } }, res, next);
        requireRecentMfa({ method: "POST", decodedToken: { id: 1, impersonated: true } }, res, next);
        requireRecentMfa({ method: "POST", headers: {}, cookies: {} }, res, next); // no token: auth answers 401
        expect(next).toHaveBeenCalledTimes(4);
    });

    test("step-up re-issues the same session with a fresh proof", () => {
        const cookie = jest.fn();
        const req = { headers: { host: "app.example.test" }, decodedToken: { id: 1, sid: "s1", tenant_id: 3, aud: "tenant", iat: 1, exp: 2 } };
        reissueWithStepUp(req, { cookie });
        const [name, token] = cookie.mock.calls[0];
        expect(name).toBe("token");
        const claims = jwt.verify(token, process.env.JWT_SECRET);
        expect(claims).toMatchObject({ id: 1, sid: "s1", tenant_id: 3, aud: "tenant" });
        expect(hasRecentStepUp(claims.mfa_at)).toBe(true);
    });
});
describe("admin MFA guards", () => {
    const loadMfaPrincipal = jest.fn();
    beforeAll(() => {
        jest.doMock("../services/adminMfaPrincipal", () => ({ loadMfaPrincipal: (...a: unknown[]) => loadMfaPrincipal(...a) }));
    });

    test("an admin adds a sign-in credential only with a recent second factor", async () => {
        jest.resetModules();
        jest.doMock("../services/adminMfaPrincipal", () => ({ loadMfaPrincipal: (...a: unknown[]) => loadMfaPrincipal(...a) }));
        const { requireStepUpForAdmins } = require("../services/adminMfaGate");
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
        const next = jest.fn();

        loadMfaPrincipal.mockResolvedValue({ required: true });
        await requireStepUpForAdmins({ userId: 1, tenantId: 3, decodedToken: {} }, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();

        await requireStepUpForAdmins({ userId: 1, tenantId: 3, decodedToken: { mfa_at: Math.floor(Date.now() / 1000) } }, res, next);
        loadMfaPrincipal.mockResolvedValue({ required: false });
        await requireStepUpForAdmins({ userId: 2, tenantId: 3, decodedToken: {} }, res, next);
        expect(next).toHaveBeenCalledTimes(2);
    });
});