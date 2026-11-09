import {
    findAccessibleProjectIds,
    findGeneratedProjectIdForTeam,
    findProjectRoles,
    findProjectRolesForProjects,
    findProjectById,
    type ProjectAccessRepositoryDb,
} from "./tasks.projectAccessRepository";

import type { ProjectRole } from "./tasks.projectTypes";
export type { ProjectRole } from "./tasks.projectTypes";
export type ProjectAction = "administer" | "manageMembers" | "renameKey";

export interface ProjectRoleInput {
    orgRole: string | null | undefined;
    personalRole: ProjectRole | null;
    teamRoles: ProjectRole[];
}

const ROLE_RANK: Record<ProjectRole, number> = {
    viewer: 1,
    member: 2,
    project_admin: 3,
};

const ORG_ADMIN_ROLES = new Set(["super_admin", "hr_admin", "platform_admin"]);

export function resolveEffectiveProjectRole(input: ProjectRoleInput): ProjectRole | null {
    if (ORG_ADMIN_ROLES.has(input.orgRole ?? "")) return "project_admin";
    return [input.personalRole, ...input.teamRoles]
        .filter((role): role is ProjectRole => role !== null)
        .sort((left, right) => ROLE_RANK[right] - ROLE_RANK[left])[0] ?? null;
}

export function projectRoleAllows(role: ProjectRole | null, action: ProjectAction): boolean {
    if (action === "administer" || action === "manageMembers" || action === "renameKey") return role === "project_admin";
    return false;
}

export interface ProjectAccessActor {
    userId: number;
    orgId: number | null;
    orgRole: string | null;
    teamIds?: number[];
}

export interface ProjectCapabilities {
    canAdminister: boolean;
    canCreateTickets: boolean;
    canManageMembers: boolean;
    canEditWorkflow: boolean;
    canRenameKey: boolean;
    canArchive: boolean;
    canChangeType: boolean;
}

export function projectCapabilities(role: ProjectRole | null, archived = false): ProjectCapabilities {
    const admin = role === "project_admin";
    return {
        canAdminister: admin,
        canCreateTickets: !archived && (admin || role === "member"),
        canManageMembers: admin,
        canEditWorkflow: admin && !archived,
        canRenameKey: admin && !archived,
        canArchive: admin && !archived,
        canChangeType: admin && !archived,
    };
}

/** Create one access resolver per request; its memoized roles never cross requests. */
export function createProjectAccess(db: ProjectAccessRepositoryDb, actor: ProjectAccessActor) {
    const roles = new Map<number, Promise<ProjectRole | null>>();
    const teamProjects = new Map<number, Promise<number | null>>();
    let accessibleProjects: Promise<number[]> | undefined;

    function roleForProject(projectId: number): Promise<ProjectRole | null> {
        let role = roles.get(projectId);
        if (!role) {
            role = (async () => {
                if (!actor.orgId) return null;
                const grants = await findProjectRoles(db, {
                    projectId,
                    userId: actor.userId,
                    orgId: actor.orgId!,
                    teamIds: actor.teamIds,
                });
                return resolveEffectiveProjectRole({
                    orgRole: actor.orgRole,
                    personalRole: grants.find((grant) => grant.userId === actor.userId)?.role ?? null,
                    teamRoles: grants.filter((grant) => grant.teamId != null).map((grant) => grant.role),
                });
            })();
            roles.set(projectId, role);
        }
        return role;
    }

    async function accessibleProjectIds(): Promise<number[]> {
        if (!actor.orgId) return [];
        accessibleProjects ??= findAccessibleProjectIds(db, {
            userId: actor.userId,
            orgId: actor.orgId,
            teamIds: actor.teamIds,
            orgRole: actor.orgRole,
        });
        return accessibleProjects;
    }

    async function projectForTeam(teamId: number): Promise<number | null> {
        if (!actor.orgId) return null;
        let projectId = teamProjects.get(teamId);
        if (!projectId) {
            projectId = findGeneratedProjectIdForTeam(db, teamId, actor.orgId);
            teamProjects.set(teamId, projectId);
        }
        return projectId;
    }

    async function capabilities(projectId: number, archived?: boolean): Promise<ProjectCapabilities> {
        const role = await roleForProject(projectId);
        const isArchived = archived ?? (actor.orgId
            ? (await findProjectById(db, projectId, actor.orgId))?.is_archived === true : false);
        return projectCapabilities(role, isArchived);
    }

    async function capabilitiesForProjects(projectIds: number[]): Promise<Map<number, ProjectCapabilities>> {
        const uniqueIds = [...new Set(projectIds.map(Number))];
        if (uniqueIds.length === 0 || !actor.orgId) return new Map();
        const grantsByProject = await findProjectRolesForProjects(db, {
            projectIds: uniqueIds,
            userId: actor.userId,
            orgId: actor.orgId,
            teamIds: actor.teamIds,
        });
        const capabilitiesByProject = new Map<number, ProjectCapabilities>();
        for (const projectId of uniqueIds) {
            const grants = grantsByProject.get(projectId) ?? [];
            const role = resolveEffectiveProjectRole({
                orgRole: actor.orgRole,
                personalRole: grants.find((grant) => grant.userId === actor.userId)?.role ?? null,
                teamRoles: grants.filter((grant) => grant.teamId != null).map((grant) => grant.role),
            });
            capabilitiesByProject.set(projectId, projectCapabilities(role));
        }
        return capabilitiesByProject;
    }

    return {
        roleForProject,
        accessibleProjectIds,
        projectForTeam,
        capabilities,
        capabilitiesForProjects,
        allows: async (projectId: number, action: ProjectAction) =>
            projectRoleAllows(await roleForProject(projectId), action),
    };
}
