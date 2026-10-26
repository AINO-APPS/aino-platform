/**
 * The ticket access policy is the single answer to "can this person see and
 * change this ticket?".
 *
 * These tests are the visibility matrix from the spec, expressed against the
 * policy directly: team member, team lead, org admin, user without a team,
 * non-member, and legacy rows with no owning team — with the
 * `team_visibility` flag both on and off.
 */
import {
    buildVisibilityPredicate,
    canAccessSprint,
    canChangeTaskStatus,
    canReadTask,
    canWriteTask,
    isOrgAdmin,
    rejectsForeignTeamRequest,
    resolveTaskVisibility,
    type TaskActor,
    type TaskVisibility,
} from "../modules/tasks/tasks.policy";

const ORG = 1;
const TEAM_A = 10;
const TEAM_B = 20;

function actor(overrides: Partial<TaskActor> = {}): TaskActor {
    return {
        userId: 100,
        orgId: ORG,
        teamId: TEAM_A,
        role: "employee",
        teamVisibility: true,
        ...overrides,
    };
}

const member = actor();
const lead = actor({ userId: 101, role: "team_lead" });
const admin = actor({ userId: 102, teamId: null, role: "hr_admin" });
const noTeam = actor({ userId: 103, teamId: null, role: "employee" });
const outsider = actor({ userId: 104, teamId: TEAM_B, role: "manager" });

/** A ticket owned by TEAM_A, created and assigned to other people. */
const teamATicket = {
    id: 1, user_id: 999, assigned_to: 998, org_id: ORG, team_id: TEAM_A,
};
const teamBTicket = {
    id: 2, user_id: 999, assigned_to: 998, org_id: ORG, team_id: TEAM_B,
};
const unownedTicket = {
    id: 3, user_id: 103, assigned_to: null, org_id: ORG, team_id: null,
};

describe("visibility matrix (flag on)", () => {
    test("a team member reads every ticket the team owns", () => {
        expect(canReadTask(teamATicket, member)).toBe(true);
        expect(canReadTask(teamBTicket, member)).toBe(false);
    });

    test("a team lead has no ticket privileges beyond the team", () => {
        expect(canReadTask(teamATicket, lead)).toBe(true);
        expect(canReadTask(teamBTicket, lead)).toBe(false);
    });

    test("an org admin reads every team's tickets", () => {
        expect(canReadTask(teamATicket, admin)).toBe(true);
        expect(canReadTask(teamBTicket, admin)).toBe(true);
        expect(canReadTask(unownedTicket, admin)).toBe(true);
    });

    test("a user without a team reads only tickets they created or are assigned", () => {
        expect(canReadTask(unownedTicket, noTeam)).toBe(true);
        expect(canReadTask(teamATicket, noTeam)).toBe(false);
        expect(canReadTask({ ...teamATicket, assigned_to: noTeam.userId }, noTeam)).toBe(true);
    });

    test("a non-member of the team gets nothing", () => {
        expect(canReadTask(teamATicket, outsider)).toBe(false);
        expect(canWriteTask(teamATicket, outsider)).toBe(false);
    });

    test("legacy unowned tickets are visible only to their owner and admins", () => {
        const other = actor({ userId: 555 });
        expect(canReadTask(unownedTicket, other)).toBe(false);
        expect(canReadTask(unownedTicket, admin)).toBe(true);
    });

    test("another organisation's ticket is never readable", () => {
        expect(canReadTask({ ...teamATicket, org_id: 2 }, admin)).toBe(false);
    });

    test("legacy rows without org_id are still readable by their owner and admins", () => {
        const legacy = { ...teamATicket, org_id: null, user_id: member.userId, team_id: null };
        expect(canReadTask(legacy, member)).toBe(true);
        expect(canReadTask(legacy, admin)).toBe(true);
        expect(canReadTask(legacy, actor({ userId: 777 }))).toBe(false);
    });

    test("any owning-team member may change status, not only the assignee", () => {
        expect(canChangeTaskStatus(teamATicket, member)).toBe(true);
        expect(canChangeTaskStatus(teamATicket, outsider)).toBe(false);
        expect(canChangeTaskStatus(teamATicket, admin)).toBe(true);
    });

    test("ownership wins over authorship: a Team B assignee cannot read a Team A ticket", () => {
        const assignedAcross = { ...teamATicket, user_id: outsider.userId, assigned_to: outsider.userId };
        expect(canReadTask(assignedAcross, outsider)).toBe(false);
        expect(canChangeTaskStatus(assignedAcross, outsider)).toBe(false);
    });
});

describe("visibility matrix (flag off restores creator-team behaviour)", () => {
    const legacyActor = actor({ teamVisibility: false });

    test("a teammate still sees tickets created by their team", () => {
        // The creator (999) is on TEAM_A in this fixture.
        expect(canReadTask(teamATicket, legacyActor, TEAM_A)).toBe(true);
        expect(canReadTask(teamATicket, { ...legacyActor, teamId: TEAM_B }, TEAM_A)).toBe(false);
    });

    test("status changes remain assignee/reporter only", () => {
        expect(canChangeTaskStatus(teamATicket, legacyActor, TEAM_A)).toBe(false);
        expect(canChangeTaskStatus(
            { ...teamATicket, assigned_to: legacyActor.userId },
            legacyActor,
            TEAM_A,
        )).toBe(true);
    });
});

describe("list visibility resolution", () => {
    test("members are pinned to their own team", () => {
        expect(resolveTaskVisibility(member)).toEqual({
            kind: "team", userId: member.userId, teamId: TEAM_A,
        });
    });

    test("admins default to the whole org and may switch teams", () => {
        expect(resolveTaskVisibility(admin)).toEqual({ kind: "org-admin" });
        expect(resolveTaskVisibility(admin, { teamId: TEAM_B })).toEqual({
            kind: "team", userId: admin.userId, teamId: TEAM_B,
        });
        expect(resolveTaskVisibility(admin, { unassigned: true })).toEqual({ kind: "unassigned" });
    });

    test("non-admins cannot widen scope with team_id or the unassigned bucket", () => {
        expect(resolveTaskVisibility(member, { teamId: TEAM_B })).toEqual({
            kind: "team", userId: member.userId, teamId: TEAM_A,
        });
        expect(resolveTaskVisibility(member, { unassigned: true })).toEqual({
            kind: "personal", userId: member.userId,
        });
        expect(rejectsForeignTeamRequest(member, TEAM_B)).toBe(true);
        expect(rejectsForeignTeamRequest(admin, TEAM_B)).toBe(false);
    });

    test("users without a team fall back to their own tickets", () => {
        expect(resolveTaskVisibility(noTeam)).toEqual({ kind: "personal", userId: noTeam.userId });
    });

    test("personal scope wins for anyone who asks for it", () => {
        expect(resolveTaskVisibility(admin, { scope: "personal" })).toEqual({
            kind: "personal", userId: admin.userId,
        });
    });
});

describe("SQL predicate", () => {
    function predicate(visibility: TaskVisibility, start = 1) {
        const built = buildVisibilityPredicate(visibility, start);
        return { ...built, sql: built.sql.replace(/\s+/g, " ").trim() };
    }

    test("team visibility anchors on the ticket's own team", () => {
        const p = predicate({ kind: "team", userId: 100, teamId: TEAM_A });
        expect(p.sql).toBe("t.team_id = $1");
        expect(p.params).toEqual([TEAM_A]);
        expect(p.nextIndex).toBe(2);
    });

    test("legacy visibility anchors on the creator's team", () => {
        const p = predicate({ kind: "legacy-team", userId: 100, teamId: TEAM_A }, 4);
        expect(p.sql).toBe(
            "(t.user_id = $4 OR t.assigned_to = $4 OR t.user_id IN (SELECT id FROM users WHERE team_id = $5))",
        );
        expect(p.params).toEqual([100, TEAM_A]);
        expect(p.nextIndex).toBe(6);
    });

    test("personal and unassigned predicates", () => {
        expect(predicate({ kind: "personal", userId: 7 }).sql).toBe(
            "(t.user_id = $1 OR t.assigned_to = $1)",
        );
        expect(predicate({ kind: "unassigned" }).sql).toBe("t.team_id IS NULL");
    });

    test("org admins see every owned ticket; unowned rows stay in the bucket", () => {
        const p = predicate({ kind: "org-admin" }, 3);
        expect(p.sql).toBe("t.team_id IS NOT NULL");
        expect(p.params).toEqual([]);
        expect(p.nextIndex).toBe(3);
    });
});

describe("sprint access", () => {
    const sprint = { id: 1, team_id: TEAM_A, org_id: ORG };

    test("members read their team's sprint; non-members do not", () => {
        expect(canAccessSprint(sprint, member)).toBe(true);
        expect(canAccessSprint(sprint, outsider)).toBe(false);
        expect(canAccessSprint(sprint, noTeam)).toBe(false);
    });

    test("admins read every sprint in the org only", () => {
        expect(canAccessSprint(sprint, admin)).toBe(true);
        expect(canAccessSprint({ ...sprint, org_id: 2, team_org_id: 2 }, admin)).toBe(false);
    });
});

describe("admin role detection", () => {
    test("only the three org-admin roles are admins", () => {
        expect(isOrgAdmin("super_admin")).toBe(true);
        expect(isOrgAdmin("hr_admin")).toBe(true);
        expect(isOrgAdmin("platform_admin")).toBe(true);
        expect(isOrgAdmin("manager")).toBe(false);
        expect(isOrgAdmin("team_lead")).toBe(false);
        expect(isOrgAdmin(null)).toBe(false);
    });
});
