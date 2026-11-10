import type { ProjectRole } from "./tasks.projectTypes";

export interface ProjectAccessRepositoryDb {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
    transaction?: <T>(fn: (client: ProjectAccessRepositoryDb) => Promise<T>) => Promise<T>;
}

export interface ProjectGrantRow {
    userId: number | null;
    teamId: number | null;
    role: ProjectRole;
}

interface ActorProjectQuery {
    userId: number;
    orgId: number;
    teamIds?: number[];
}

const ORG_ADMIN_ROLES = ["super_admin", "hr_admin", "platform_admin"];
const PROJECT_ROLES = new Set<ProjectRole>(["project_admin", "member", "viewer"]);

export async function listActiveProjects(db: ProjectAccessRepositoryDb, orgId: number): Promise<any[]> {
    return (await db.query(
        "SELECT * FROM projects WHERE org_id = $1 AND is_archived = FALSE ORDER BY LOWER(name), id",
        [orgId],
    )).rows;
}

export class ProjectAccessRepositoryError extends Error {
    constructor(
        message: string,
        readonly code: "PROJECT_NOT_FOUND" | "INVALID_MEMBER" | "LAST_PROJECT_ADMIN",
    ) {
        super(message);
    }
}

function actorTeamsCte(): string {
    return `actor_teams AS (
        SELECT UNNEST(COALESCE($4::int[], ARRAY[]::int[])) AS team_id
        UNION
        SELECT team_id FROM users WHERE id = $2 AND org_id = $3 AND team_id IS NOT NULL
    )`;
}

export async function findProjectRoles(
    db: ProjectAccessRepositoryDb,
    input: ActorProjectQuery & { projectId: number },
): Promise<ProjectGrantRow[]> {
    const result = await db.query(
        `WITH ${actorTeamsCte()}
         SELECT pm.user_id, pm.team_id, pm.role
           FROM project_members pm
           JOIN projects p ON p.id = pm.project_id
          WHERE p.id = $1 AND p.org_id = $3
            AND (pm.user_id = $2 OR pm.team_id IN (SELECT team_id FROM actor_teams))`,
        [input.projectId, input.userId, input.orgId, input.teamIds ?? []],
    );
    return result.rows.map((row) => ({
        userId: row.user_id == null ? null : Number(row.user_id),
        teamId: row.team_id == null ? null : Number(row.team_id),
        role: row.role as ProjectRole,
    }));
}

export async function findAccessibleProjectIds(
    db: ProjectAccessRepositoryDb,
    input: ActorProjectQuery & { orgRole: string | null },
): Promise<number[]> {
    if (input.orgRole && ORG_ADMIN_ROLES.includes(input.orgRole)) {
        const all = await db.query("SELECT id FROM projects WHERE org_id = $1", [input.orgId]);
        return all.rows.map((row) => Number(row.id));
    }

    const result = await db.query(
        `WITH actor_teams AS (
            SELECT UNNEST($3::int[]) AS team_id
            UNION
            SELECT team_id FROM users WHERE id = $1 AND org_id = $2 AND team_id IS NOT NULL
         )
         SELECT DISTINCT p.id
           FROM projects p
           JOIN project_members pm ON pm.project_id = p.id
          WHERE p.org_id = $2
            AND (pm.user_id = $1 OR pm.team_id IN (SELECT team_id FROM actor_teams))
          ORDER BY p.id`,
        [input.userId, input.orgId, input.teamIds ?? []],
    );
    return result.rows.map((row) => Number(row.id));
}

export async function findGeneratedProjectIdForTeam(
    db: ProjectAccessRepositoryDb,
    teamId: number,
    orgId: number,
): Promise<number | null> {
    const result = await db.query(
        "SELECT id FROM projects WHERE org_id = $1 AND origin_team_id = $2",
        [orgId, teamId],
    );
    return result.rows[0] == null ? null : Number(result.rows[0].id);
}

export async function findProjectRolesForProjects(
    db: ProjectAccessRepositoryDb,
    input: ActorProjectQuery & { projectIds: number[] },
): Promise<Map<number, ProjectGrantRow[]>> {
    if (input.projectIds.length === 0) return new Map();
    const result = await db.query(
        `WITH actor_teams AS (
            SELECT UNNEST($3::int[]) AS team_id
            UNION
            SELECT team_id FROM users WHERE id = $1 AND org_id = $2 AND team_id IS NOT NULL
         )
         SELECT pm.project_id, pm.user_id, pm.team_id, pm.role
           FROM project_members pm
           JOIN projects p ON p.id = pm.project_id
          WHERE p.org_id = $2 AND p.id = ANY($4::int[])
            AND (pm.user_id = $1 OR pm.team_id IN (SELECT team_id FROM actor_teams))`,
        [input.userId, input.orgId, input.teamIds ?? [], input.projectIds],
    );
    const grantsByProject = new Map<number, ProjectGrantRow[]>();
    for (const row of result.rows) {
        const projectId = Number(row.project_id);
        const grants = grantsByProject.get(projectId) ?? [];
        grants.push({
            userId: row.user_id == null ? null : Number(row.user_id),
            teamId: row.team_id == null ? null : Number(row.team_id),
            role: row.role as ProjectRole,
        });
        grantsByProject.set(projectId, grants);
    }
    return grantsByProject;
}

export interface ProjectMemberWrite {
    projectId: number;
    orgId: number;
    grantedBy: number;
    subjectType: "user" | "team";
    subjectId: number;
    role: ProjectRole;
}

function assertRole(role: string): asserts role is ProjectRole {
    if (!PROJECT_ROLES.has(role as ProjectRole)) {
        throw new ProjectAccessRepositoryError("Invalid project role", "INVALID_MEMBER");
    }
}

async function transaction<T>(
    db: ProjectAccessRepositoryDb,
    work: (client: ProjectAccessRepositoryDb) => Promise<T>,
): Promise<T> {
    if (!db.transaction) throw new Error("Project access writes require a transaction-capable database");
    return db.transaction(work);
}

async function lockProject(client: ProjectAccessRepositoryDb, projectId: number, orgId: number): Promise<void> {
    const project = await client.query(
        "SELECT id FROM projects WHERE id = $1 AND org_id = $2 FOR UPDATE",
        [projectId, orgId],
    );
    if (project.rows.length === 0) {
        throw new ProjectAccessRepositoryError("Project not found", "PROJECT_NOT_FOUND");
    }
}

async function ensureNotLastProjectAdmin(
    client: ProjectAccessRepositoryDb,
    projectId: number,
    exceptMemberId: number,
): Promise<void> {
    const admins = await client.query(
        "SELECT COUNT(*)::int AS count FROM project_members WHERE project_id = $1 AND role = 'project_admin' AND id <> $2",
        [projectId, exceptMemberId],
    );
    if (Number(admins.rows[0]?.count ?? 0) === 0) {
        throw new ProjectAccessRepositoryError("A project must have at least one project admin", "LAST_PROJECT_ADMIN");
    }
}

async function validateSubject(client: ProjectAccessRepositoryDb, input: ProjectMemberWrite): Promise<void> {
    const table = input.subjectType === "user" ? "users" : "teams";
    const active = input.subjectType === "user" ? " AND is_active = TRUE" : "";
    const result = await client.query(
        `SELECT id FROM ${table} WHERE id = $1 AND org_id = $2${active}`,
        [input.subjectId, input.orgId],
    );
    if (result.rows.length === 0) {
        throw new ProjectAccessRepositoryError("The selected user or team is not active in this organization", "INVALID_MEMBER");
    }
}

export async function listProjectMembers(
    db: ProjectAccessRepositoryDb,
    projectId: number,
    orgId: number,
): Promise<any[]> {
    const result = await db.query(
        `SELECT pm.id, pm.project_id, pm.user_id, pm.team_id, pm.role, pm.granted_by, pm.created_at,
                u.full_name AS user_name, u.username,
                t.name AS team_name,
                grantor.full_name AS granted_by_name
           FROM project_members pm
      LEFT JOIN users u ON u.id = pm.user_id
      LEFT JOIN teams t ON t.id = pm.team_id
      LEFT JOIN users grantor ON grantor.id = pm.granted_by
          WHERE pm.project_id = $1 AND EXISTS (
              SELECT 1 FROM projects p WHERE p.id = pm.project_id AND p.org_id = $2
          )
          ORDER BY CASE pm.role WHEN 'project_admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END,
                   COALESCE(u.full_name, t.name, u.username)`,
        [projectId, orgId],
    );
    return result.rows;
}

export async function findProjectById(
    db: ProjectAccessRepositoryDb,
    projectId: number,
    orgId: number,
): Promise<any | null> {
    const result = await db.query(
        "SELECT id, org_id, is_archived FROM projects WHERE id = $1 AND org_id = $2",
        [projectId, orgId],
    );
    return result.rows[0] ?? null;
}

export async function upsertProjectMember(
    db: ProjectAccessRepositoryDb,
    input: ProjectMemberWrite,
): Promise<any> {
    assertRole(input.role);
    return transaction(db, async (client) => {
        await lockProject(client, input.projectId, input.orgId);
        await validateSubject(client, input);
        const subjectColumn = input.subjectType === "user" ? "user_id" : "team_id";
        const existing = await client.query(
            `SELECT id, role FROM project_members WHERE project_id = $1 AND ${subjectColumn} = $2 FOR UPDATE`,
            [input.projectId, input.subjectId],
        );
        if (existing.rows[0]?.role === "project_admin" && input.role !== "project_admin") {
            await ensureNotLastProjectAdmin(client, input.projectId, Number(existing.rows[0].id));
        }
        const result = await client.query(
            `INSERT INTO project_members (project_id, ${subjectColumn}, role, granted_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (project_id, ${subjectColumn})
             DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, created_at = NOW()
             RETURNING *`,
            [input.projectId, input.subjectId, input.role, input.grantedBy],
        );
        return result.rows[0];
    });
}

export async function updateProjectMemberRole(
    db: ProjectAccessRepositoryDb,
    input: { projectId: number; orgId: number; memberId: number; role: ProjectRole; grantedBy: number },
): Promise<any> {
    assertRole(input.role);
    return transaction(db, async (client) => {
        await lockProject(client, input.projectId, input.orgId);
        const member = await client.query(
            "SELECT id, role FROM project_members WHERE id = $1 AND project_id = $2 FOR UPDATE",
            [input.memberId, input.projectId],
        );
        if (member.rows.length === 0) {
            throw new ProjectAccessRepositoryError("Project member not found", "INVALID_MEMBER");
        }
        if (member.rows[0].role === "project_admin" && input.role !== "project_admin") {
            await ensureNotLastProjectAdmin(client, input.projectId, input.memberId);
        }
        const updated = await client.query(
            "UPDATE project_members SET role = $1, granted_by = $2, created_at = NOW() WHERE id = $3 RETURNING *",
            [input.role, input.grantedBy, input.memberId],
        );
        return updated.rows[0];
    });
}

export async function removeProjectMember(
    db: ProjectAccessRepositoryDb,
    input: { projectId: number; orgId: number; memberId: number },
): Promise<void> {
    return transaction(db, async (client) => {
        await lockProject(client, input.projectId, input.orgId);
        const member = await client.query(
            "SELECT id, role FROM project_members WHERE id = $1 AND project_id = $2 FOR UPDATE",
            [input.memberId, input.projectId],
        );
        if (member.rows.length === 0) {
            throw new ProjectAccessRepositoryError("Project member not found", "INVALID_MEMBER");
        }
        if (member.rows[0].role === "project_admin") {
            await ensureNotLastProjectAdmin(client, input.projectId, input.memberId);
        }
        await client.query("DELETE FROM project_members WHERE id = $1", [input.memberId]);
    });
}

export interface ProjectCreateInput {
    orgId: number;
    creatorId: number;
    key: string;
    name: string;
    description: string | null;
    color: string;
    leadUserId: number | null;
    teamIds: number[];
}

export async function createProjectWithGrants(
    db: ProjectAccessRepositoryDb,
    input: ProjectCreateInput,
): Promise<any> {
    return transaction(db, async (client) => {
        const uniqueTeamIds = [...new Set(input.teamIds)];
        if (uniqueTeamIds.length > 0) {
            const teams = await client.query(
                "SELECT id FROM teams WHERE org_id = $1 AND id = ANY($2::int[])",
                [input.orgId, uniqueTeamIds],
            );
            if (teams.rows.length !== uniqueTeamIds.length) {
                throw new ProjectAccessRepositoryError("One or more selected teams are not in this organization", "INVALID_MEMBER");
            }
        }
        await client.query(
            "INSERT INTO reserved_project_keys (org_id, key, reason) VALUES ($1, $2, 'project')",
            [input.orgId, input.key],
        );
        const inserted = await client.query(
            `INSERT INTO projects (org_id, key, name, description, color, lead_user_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [input.orgId, input.key, input.name, input.description, input.color, input.leadUserId, input.creatorId],
        );
        const project = inserted.rows[0];
        await client.query(
            `INSERT INTO project_members (project_id, user_id, role, granted_by)
             VALUES ($1, $2, 'project_admin', $2)
             ON CONFLICT (project_id, user_id) DO NOTHING`,
            [project.id, input.creatorId],
        );
        for (const teamId of uniqueTeamIds) {
            await client.query(
                `INSERT INTO project_members (project_id, team_id, role, granted_by)
                 VALUES ($1, $2, 'member', $3)
                 ON CONFLICT (project_id, team_id) DO NOTHING`,
                [project.id, teamId, input.creatorId],
            );
        }
        return project;
    });
}
