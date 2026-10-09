import type { Request, Response, NextFunction } from "express";
import { isMobileClient } from "../middleware/webOnly";
import { hasRecentStepUp, mfaRequiredForLevel, readMfaState, signMfaTicket } from "./adminMfa";
import { loadMfaPrincipal } from "./adminMfaPrincipal";
const { levelForRole, getTenantRolesMap } = require("../middleware/rbac");

/** Request header carrying a fresh MFA proof minted by `POST /auth/mfa/verify`. */
export const MFA_PROOF_LOCAL = "mfaVerifiedAt";

/**
 * Route guard: an administrator may add a sign-in credential (biometric device
 * key, passkey) only with a second factor from the last 10 minutes. Otherwise
 * a session that skipped MFA (an app sign-in) could mint a credential and use
 * it to sign in to the web without MFA. Non-admins pass straight through.
 */
export async function requireStepUpForAdmins(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
        const r = req as any;
        const isPlatformUser = !!r.isPlatformUser && !r.tenantId;
        const who = await loadMfaPrincipal(r.userId, r.tenantId ? Number(r.tenantId) : null, isPlatformUser);
        if (!who?.required || hasRecentStepUp(r.decodedToken?.mfa_at)) return next();
        return res.status(403).json({ error: "Confirm it's you: enter the code from your authenticator app.", code: "MFA_STEP_UP_REQUIRED" });
    } catch (err) {
        return next(err);
    }
}

/**
 * Sign-in gate (P2.1): an administrator on web / desktop must pass a second
 * factor before a session exists. Answers `MFA_REQUIRED` (or
 * `MFA_ENROLL_REQUIRED` for an admin without MFA yet) with a 5-minute ticket
 * and returns true; returns false when sign-in may continue.
 *
 * App sign-ins are not gated: the token they get is marked `cli: mobile`, which
 * every admin route refuses (middleware/webOnly.ts), and it never carries an
 * MFA proof. Spoofing the app headers therefore only yields a session that
 * cannot administer anything, and adding a sign-in credential from it needs
 * a step-up ([requireStepUpForAdmins]).
 */
export async function requireAdminSecondFactor(
    req: Request,
    res: Response,
    params: { user: any; db: any; tenantId: number | null; isPlatformUser: boolean },
): Promise<boolean> {
    const { user, db, tenantId, isPlatformUser } = params;
    if (res.locals[MFA_PROOF_LOCAL] || isMobileClient(req)) return false;
    const level = isPlatformUser ? 6 : levelForRole(user.role, await getTenantRolesMap(db, user.org_id, tenantId));
    if (!mfaRequiredForLevel(level, isPlatformUser)) return false;

    const state = await readMfaState(db, user.id, isPlatformUser).catch(() => null);
    // Tenant DB not yet migrated: let the admin in rather than lock them out.
    if (!state) return false;
    const purpose = state.enabled ? "verify" : "enroll";
    const ticket = signMfaTicket({ uid: user.id, tid: tenantId, plat: isPlatformUser, purpose });
    res.status(401).json(state.enabled
        ? { error: "Enter the 6-digit code from your authenticator app.", code: "MFA_REQUIRED", mfaTicket: ticket }
        : { error: "Administrators must set up two-step verification before signing in.", code: "MFA_ENROLL_REQUIRED", mfaTicket: ticket });
    return true;
}
