/**
 * Work-mode lock (product decision 2026-10-08).
 *
 * The first clock-in of a local day fixes that day's work mode. Clocking in
 * again with another mode is refused until a `work_mode_change` request for
 * the same date is approved through the normal approver routing.
 */
import type { AttendanceActor, AttendanceDb } from "./attendance.types";
import { AttendanceError, WorkModeLockedError } from "./attendance.types";
import * as repository from "./attendance.repository";
import { approvalLink } from "../../utils/notificationLinks";

interface WorkModeDependencies {
    findApprover: (db: AttendanceDb, userId: number, orgId: number | null) => Promise<{ id: number } | null>;
    sendToUser: (tenantId: number | null | undefined, userId: number, type: string, data: unknown) => void;
    notifyUser: (
        db: AttendanceDb,
        tenantId: number | null | undefined,
        userId: number,
        type: string,
        title: string,
        body: string,
        opts?: { actorId?: number | null; link?: string | null },
    ) => Promise<void>;
}

export function createWorkModeService(deps: WorkModeDependencies) {
    return {
        async assertWorkModeAllowed(
            db: AttendanceDb,
            userId: number,
            date: string,
            timezoneModifier: string,
            requestedMode: string,
        ): Promise<void> {
            const lockedMode = await repository.firstClockInModeForDay(db, userId, date, timezoneModifier);
            if (!lockedMode || lockedMode === requestedMode) return;
            if (await repository.hasApprovedWorkModeChange(db, userId, date, requestedMode)) return;
            throw new WorkModeLockedError(lockedMode, requestedMode);
        },

        async createWorkModeChangeRequest(
            db: AttendanceDb,
            actor: AttendanceActor,
            input: { date: string; workMode: string; reason: string; timezoneModifier: string },
        ): Promise<{ approvalId: number | null; approverId: number | null }> {
            const lockedMode = await repository.firstClockInModeForDay(db, actor.userId, input.date, input.timezoneModifier);
            if (!lockedMode) {
                throw new AttendanceError("You haven't clocked in today yet; pick any work mode when you clock in.");
            }
            if (lockedMode === input.workMode) {
                throw new AttendanceError(`Today's work mode is already ${input.workMode}.`);
            }
            if (await repository.hasPendingWorkModeChange(db, actor.userId, input.date)) {
                throw new AttendanceError("You already have a pending work mode change request for today.", 409);
            }
            if (await repository.hasApprovedWorkModeChange(db, actor.userId, input.date, input.workMode)) {
                throw new AttendanceError(`Switching to ${input.workMode} is already approved for today.`, 409);
            }
            const approver = await deps.findApprover(db, actor.userId, actor.orgId);
            const approverId = approver?.id || null;
            const approvalId = await repository.insertWorkModeChangeRequest(db, actor, approverId, {
                date: input.date, workMode: input.workMode, fromMode: lockedMode, reason: input.reason,
            });
            if (approverId) {
                try {
                    const requesterName = await repository.getUserDisplayName(db, actor.userId);
                    await deps.notifyUser(db, actor.tenantId, approverId, "approval", "Work Mode Change Request",
                        `${requesterName} asked to switch from ${lockedMode} to ${input.workMode} for ${input.date}.`,
                        { actorId: actor.userId, link: approvalLink(approvalId) });
                    deps.sendToUser(actor.tenantId, approverId, "approval_update", {
                        ...(approvalId ? { id: approvalId } : {}),
                        type: "work_mode_change",
                        status: "pending",
                    });
                } catch {
                    // Best-effort: the approval row is the source of truth.
                }
            }
            return { approvalId, approverId };
        },
    };
}
