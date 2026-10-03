/**
 * Emits `leave_policy_changed` after a successful leave-policy mutation so
 * every client refetches policies / holidays / balances live:
 *   - /policies*, /holidays*  → tenant-wide broadcast { scope }
 *   - PUT /balances/:userId   → only the affected user { scope: "balances" }
 * Mounted as router-level middleware on routes/leavePolicy.ts; it observes the
 * response status so failed/rejected mutations emit nothing.
 */
import type { NextFunction, Request, Response } from "express";
const { broadcast, sendToUser } = require("./ws");

export type LeavePolicyScope = "holidays" | "policies" | "balances";

export function leavePolicyScopeFor(method: string, path: string): { scope: LeavePolicyScope; userId?: number } | null {
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
    const [, root, param] = path.split("/");
    if (root === "policies") return { scope: "policies" };
    if (root === "holidays") return { scope: "holidays" };
    if (root === "balances" && method === "PUT") {
        const userId = Number(param);
        return Number.isFinite(userId) && userId > 0 ? { scope: "balances", userId } : null;
    }
    return null;
}

export function leavePolicyRealtime(req: Request, res: Response, next: NextFunction): void {
    const target = leavePolicyScopeFor(req.method, req.path);
    if (target) {
        res.on("finish", () => {
            if (res.statusCode < 200 || res.statusCode >= 300) return;
            try {
                if (target.userId) sendToUser(req.tenantId, target.userId, "leave_policy_changed", { scope: target.scope });
                else broadcast(req.tenantId, "leave_policy_changed", { scope: target.scope });
            } catch { /* best-effort */ }
        });
    }
    next();
}
