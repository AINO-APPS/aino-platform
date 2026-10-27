/**
 * Regression: a team sees the tickets its team owns.
 *
 * The reported defect was that members of the same team could not see the
 * sprint board, each other's tickets, or the workflow transitions on them,
 * unless they had personally created or been assigned the ticket.
 *
 * Root cause: ticket visibility was anchored on the *creator's current team*
 * rather than the ticket's team, and the team-owned model that fixes this was
 * left dormant behind a `team_visibility` flag that defaulted OFF on every
 * plan — so the fixed code path was never taken in production.
 *
 * These tests resolve the flag from a tenant row (`isFeatureEnabled`), which is
 * the same chain the request pipeline uses, so they fail if the flag regresses
 * back to off-by-default.
 */
import { isFeatureEnabled, getEffectiveFeatures } from "../utils/planCatalog";
import {
    buildVisibilityPredicate,
    canReadTask,
    canChangeTaskStatus,
    resolveTaskVisibility,
    type TaskActor,
} from "../modules/tasks/tasks.policy";

/** A ticket owned by team 2, created by a platform admin who belongs to team 1. */
const ticketOwnedByTeam2 = {
    id: 100,
    user_id: 1,
    assigned_to: null,
    org_id: 5,
    team_id: 2,
};

/** The actor as the policy resolves it, driven by the real tenant feature map. */
function actorFromTenant(tenant: { plan: string; features: Record<string, unknown> }, teamId: number): TaskActor {
    return {
        userId: 2,
        orgId: 5,
        teamId,
        role: "employee",
        teamVisibility: isFeatureEnabled(tenant, "team_visibility"),
    };
}

describe("team-owned tickets are visible to the owning team", () => {
    for (const plan of ["standard", "pro", "enterprise"]) {
        const teammate = actorFromTenant({ plan, features: {} }, 2);

        test(`${plan}: team_visibility is on by default`, () => {
            expect(getEffectiveFeatures(plan, {}).team_visibility).toBe(true);
        });

        test(`${plan}: a team member reads a ticket owned by their team`, () => {
            expect(canReadTask(ticketOwnedByTeam2, teammate, 1)).toBe(true);
        });

        test(`${plan}: a team member may move a ticket owned by their team`, () => {
            expect(canChangeTaskStatus(ticketOwnedByTeam2, teammate, 1)).toBe(true);
        });

        test(`${plan}: the list predicate anchors on the ticket's team`, () => {
            const predicate = buildVisibilityPredicate(resolveTaskVisibility(teammate, {}), 1);
            expect(predicate.sql).toBe("t.team_id = $1");
            expect(predicate.params).toEqual([2]);
        });
    }

    test("a non-member cannot read another team's ticket", () => {
        const outsider = actorFromTenant({ plan: "enterprise", features: {} }, 9);
        expect(canReadTask(ticketOwnedByTeam2, outsider, 1)).toBe(false);
    });

    test("an org admin can read every ticket", () => {
        const admin = actorFromTenant({ plan: "enterprise", features: {} }, 1);
        admin.role = "platform_admin";
        expect(canReadTask(ticketOwnedByTeam2, admin, 1)).toBe(true);
    });

    test("a user with no team keeps the personal fallback", () => {
        const unteamed = actorFromTenant({ plan: "enterprise", features: {} }, null as any);
        unteamed.userId = 7;
        expect(canReadTask(ticketOwnedByTeam2, unteamed, 1)).toBe(false);
    });

    test("a per-tenant override can still turn the model OFF", () => {
        const teammate = actorFromTenant({ plan: "enterprise", features: { team_visibility: false } }, 2);
        expect(teammate.teamVisibility).toBe(false);
        expect(canReadTask(ticketOwnedByTeam2, teammate, 1)).toBe(false);
    });
});