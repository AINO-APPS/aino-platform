import type { ProjectAccessRepositoryDb } from "./tasks.projectAccessRepository";
import {
    beginReviewSnapshot, lockMigrationOrganization, persistOwnershipSwitch, readMigrationReview,
} from "./tasks.migrationRepository";

export class MigrationReviewError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export async function getMigrationReview(db: ProjectAccessRepositoryDb, orgId: number) {
    if (!db.transaction) throw new Error("Migration review requires transactions");
    return db.transaction(async (client) => {
        await beginReviewSnapshot(client);
        const review = await readMigrationReview(client, orgId);
        if (!review) throw new MigrationReviewError(404, "ORG_NOT_FOUND", "Organization not found");
        return review;
    });
}

export async function switchProjectOwnership(
    db: ProjectAccessRepositoryDb, orgId: number, actorId: number, enabled: boolean,
) {
    if (!db.transaction) throw new Error("Ownership switches require transactions");
    return db.transaction(async (client) => {
        const org = await lockMigrationOrganization(client, orgId);
        if (!org) throw new MigrationReviewError(404, "ORG_NOT_FOUND", "Organization not found");
        if (enabled && (org.project_ownership || org.project_ownership_switched_at)) {
            throw new MigrationReviewError(409, "ALREADY_SWITCHED", "Project ownership has already been published");
        }
        if (!enabled && !org.project_ownership) {
            throw new MigrationReviewError(409, "NOT_SWITCHED", "Project ownership is not enabled");
        }
        return persistOwnershipSwitch(client, orgId, actorId, enabled);
    });
}
