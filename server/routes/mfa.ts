import express from "express";
import type { Request, Response, NextFunction } from "express";
import {
    beginEnrollment, confirmEnrollment, disableMfa, hasRecentStepUp, readMfaState, readMfaTicket, verifySecondFactor,
} from "../services/adminMfa";
import { loadMfaPrincipal } from "../services/adminMfaPrincipal";
import { reissueWithStepUp } from "../middleware/requireRecentMfa";
import { STEP_UP_WINDOW_SECONDS } from "../services/adminMfa";
const auth = require("../middleware/auth");
const QRCode = require("qrcode");

/**
 * Two-step verification for administrators (P2.1). Mounted at `/api/auth/mfa`.
 *
 * Sign-in: `/login` answers `MFA_REQUIRED` / `MFA_ENROLL_REQUIRED` with a
 * ticket; the client then calls `verify` (or `enroll/start` + `enroll/confirm`)
 * with that ticket, and the session is created only then.
 * Signed in: `status`, `enroll/*` and `disable` act on the caller;
 * `step-up` refreshes the `mfa_at` proof for destructive admin actions.
 */
const router = express.Router();

/** The finishLogin of routes/auth.ts (attached there to avoid a circular import). */
function finishLogin(req: Request, res: Response, args: { user: any; db: any; tenantId: number | null; isPlatformUser: boolean }) {
    return require("./auth").finishLogin(req, res, args);
}

const fail = (res: Response, status: number, error: string, code: string) => res.status(status).json({ error, code });

/** Resolves the principal from a sign-in ticket (body) or the signed-in session. */
async function principal(req: Request, purpose?: "verify" | "enroll") {
    const ticket = req.body?.mfaTicket ? readMfaTicket(req.body.mfaTicket) : null;
    if (req.body?.mfaTicket) {
        if (!ticket || (purpose && ticket.purpose !== purpose)) return null;
        return loadMfaPrincipal(ticket.uid, ticket.tid, ticket.plat);
    }
    return null;
}

// ── Sign-in with a second factor ─────────────────────────────────────────────
router.post("/verify", async (req: Request, res: Response) => {
    try {
        const who = await principal(req, "verify");
        if (!who) return fail(res, 401, "Your sign-in expired. Enter your password again.", "MFA_TICKET_INVALID");
        const method = await verifySecondFactor(who.db, who.user.id, who.isPlatformUser, req.body?.code);
        if (!method) return fail(res, 400, "That code is not valid. Try the current code from your app.", "MFA_CODE_INVALID");
        res.locals.mfaVerifiedAt = Math.floor(Date.now() / 1000);
        res.setHeader("X-AINO-MFA-Method", method);
        return finishLogin(req, res, { user: who.user, db: who.db, tenantId: who.tenantId, isPlatformUser: who.isPlatformUser });
    } catch (err) {
        req.log.error({ err }, "MFA verify error");
        return fail(res, 500, "Two-step verification failed", "MFA_ERROR");
    }
});

// ── Enrolment (from a sign-in ticket or while signed in) ─────────────────────
router.post("/enroll/start", (req: Request, res: Response, next: NextFunction) => (req.body?.mfaTicket ? next() : auth(req, res, next)), async (req: Request, res: Response) => {
    try {
        const who = req.body?.mfaTicket ? await principal(req, "enroll") : await loadMfaPrincipal(req.userId!, req.tenantId ? Number(req.tenantId) : null, !!req.isPlatformUser && !req.tenantId);
        if (!who) return fail(res, 401, "Your sign-in expired. Enter your password again.", "MFA_TICKET_INVALID");
        // Replacing an authenticator that is already on needs a code from it, so a stolen session cannot take MFA over.
        if ((await readMfaState(who.db, who.user.id, who.isPlatformUser)).enabled && !(await verifySecondFactor(who.db, who.user.id, who.isPlatformUser, req.body?.currentCode))) {
            return fail(res, 400, "Enter a code from your current authenticator app to replace it.", "MFA_CODE_INVALID");
        }
        const account = who.user.email || who.user.username || `user-${who.user.id}`;
        const { secret, otpauthUrl } = await beginEnrollment(who.db, who.user.id, who.isPlatformUser, account);
        res.json({ secret, otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 }) });
    } catch (err) {
        req.log.error({ err }, "MFA enroll start error");
        return fail(res, 500, "Couldn't start two-step verification setup", "MFA_ERROR");
    }
});

router.post("/enroll/confirm", (req: Request, res: Response, next: NextFunction) => (req.body?.mfaTicket ? next() : auth(req, res, next)), async (req: Request, res: Response) => {
    try {
        const fromTicket = !!req.body?.mfaTicket;
        const who = fromTicket ? await principal(req, "enroll") : await loadMfaPrincipal(req.userId!, req.tenantId ? Number(req.tenantId) : null, !!req.isPlatformUser && !req.tenantId);
        if (!who) return fail(res, 401, "Your sign-in expired. Enter your password again.", "MFA_TICKET_INVALID");
        const recoveryCodes = await confirmEnrollment(who.db, who.user.id, who.isPlatformUser, req.body?.code);
        if (!recoveryCodes) return fail(res, 400, "That code is not valid. Scan the QR code again and enter the current code.", "MFA_CODE_INVALID");
        if (!fromTicket) return res.json({ enabled: true, recoveryCodes });
        // Enrolled during sign-in: finish signing in, and hand back the recovery codes once.
        res.locals.mfaVerifiedAt = Math.floor(Date.now() / 1000);
        res.locals.mfaRecoveryCodes = recoveryCodes;
        const originalJson = res.json.bind(res);
        res.json = ((body: any) => originalJson(body && typeof body === "object" ? { ...body, recoveryCodes } : body)) as any;
        return finishLogin(req, res, { user: who.user, db: who.db, tenantId: who.tenantId, isPlatformUser: who.isPlatformUser });
    } catch (err) {
        req.log.error({ err }, "MFA enroll confirm error");
        return fail(res, 500, "Couldn't finish two-step verification setup", "MFA_ERROR");
    }
});

// ── Signed-in management ─────────────────────────────────────────────────────
router.get("/status", auth, async (req: Request, res: Response) => {
    try {
        const who = await loadMfaPrincipal(req.userId!, req.tenantId ? Number(req.tenantId) : null, !!req.isPlatformUser && !req.tenantId);
        if (!who) return fail(res, 404, "User not found", "NOT_FOUND");
        const state = await readMfaState(who.db, who.user.id, who.isPlatformUser);
        res.json({ enabled: state.enabled, required: who.required, recoveryCodesLeft: state.recovery.length, stepUpValid: hasRecentStepUp((req as any).decodedToken?.mfa_at) });
    } catch (err) {
        req.log.error({ err }, "MFA status error");
        return fail(res, 500, "Couldn't load two-step verification status", "MFA_ERROR");
    }
});

router.post("/disable", auth, async (req: Request, res: Response) => {
    try {
        const who = await loadMfaPrincipal(req.userId!, req.tenantId ? Number(req.tenantId) : null, !!req.isPlatformUser && !req.tenantId);
        if (!who) return fail(res, 404, "User not found", "NOT_FOUND");
        if (who.required) return fail(res, 403, "Administrators must keep two-step verification on.", "MFA_REQUIRED_FOR_ROLE");
        if (!(await verifySecondFactor(who.db, who.user.id, who.isPlatformUser, req.body?.code))) {
            return fail(res, 400, "That code is not valid.", "MFA_CODE_INVALID");
        }
        await disableMfa(who.db, who.user.id, who.isPlatformUser);
        res.json({ enabled: false });
    } catch (err) {
        req.log.error({ err }, "MFA disable error");
        return fail(res, 500, "Couldn't turn off two-step verification", "MFA_ERROR");
    }
});

/**
 * Step-up: a signed-in admin re-enters a code before a destructive action.
 * Re-issues this session's token with a fresh `mfa_at` (same sid and expiry rules).
 */
router.post("/step-up", auth, async (req: Request, res: Response) => {
    try {
        const who = await loadMfaPrincipal(req.userId!, req.tenantId ? Number(req.tenantId) : null, !!req.isPlatformUser && !req.tenantId);
        if (!who) return fail(res, 404, "User not found", "NOT_FOUND");
        if (!(await verifySecondFactor(who.db, who.user.id, who.isPlatformUser, req.body?.code))) {
            return fail(res, 400, "That code is not valid.", "MFA_CODE_INVALID");
        }
        reissueWithStepUp(req, res);
        res.json({ stepUpValidFor: STEP_UP_WINDOW_SECONDS });
    } catch (err) {
        req.log.error({ err }, "MFA step-up error");
        return fail(res, 500, "Two-step verification failed", "MFA_ERROR");
    }
});

export default router;
