/** HTTP helper for the legacy `POST /tracker/clock-in` route (routes/tracker.ts). */
import type { Request, Response } from "express";
import { findApprover } from "../../utils/approver";
import { sendToUser, notifyUser } from "../../realtime/fanout";
import { getLocalToday, getTzModifier } from "../../utils/timezone";
import type { AttendanceDb } from "./attendance.types";
import { WorkModeLockedError } from "./attendance.types";
import { createWorkModeService } from "./attendance.workMode";

const workModes = createWorkModeService({ findApprover: findApprover as any, sendToUser, notifyUser });

/**
 * Refuses a work mode other than the one today's first clock-in fixed, unless a
 * change was approved. Sends the 409 itself and returns false when the clock-in
 * must stop.
 */
export async function guardClockInWorkMode(req: Request, res: Response, workMode: string): Promise<boolean> {
    try {
        await workModes.assertWorkModeAllowed(
            req.db as unknown as AttendanceDb, req.userId!, getLocalToday(req), getTzModifier(req), workMode,
        );
        return true;
    } catch (err) {
        if (err instanceof WorkModeLockedError) {
            res.status(409).json({
                error: err.message,
                code: err.code,
                locked_mode: err.lockedMode,
                requested_mode: err.requestedMode,
            });
            return false;
        }
        throw err;
    }
}
