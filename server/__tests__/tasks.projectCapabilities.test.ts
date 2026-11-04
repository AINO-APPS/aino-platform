import { decideTicket, type TicketDecisionContext } from "../modules/tasks/tasks.capabilities";
import type { TaskActor } from "../modules/tasks/tasks.policy";

const actor: TaskActor = { userId: 1, orgId: 1, teamId: null, role: "employee", teamVisibility: true, projectOwnership: true };
const ticket = { id: 1, org_id: 1, project_id: 10, user_id: 2, assigned_to: 3, workflow_state_id: 101 };
const context = (role: string | null, archived = false): TicketDecisionContext => ({
    lifecycle: { states: [{ id: 101, key: "todo" }, { id: 102, key: "progress" }], stateById: new Map(),
        rowsByFrom: new Map([[101, new Set([102])]]), derivedByFrom: new Map(), wipEnabled: false } as any,
    sprints: new Map(), ownerTeams: new Map(),
    projects: new Map([[10, { role, archived }]]),
} as TicketDecisionContext);

test.each(["viewer", null])("a %s cannot edit even when they are the reporter", (role) => {
    const decision = decideTicket({ ...actor, userId: 2 }, ticket, context(role));
    expect(decision.capabilities.can.edit).toEqual({ allowed: false, reason: "READ_ONLY_ROLE" });
    expect(decision.capabilities.can.comment).toEqual({ allowed: true });
});

test.each(["member", "project_admin"])("a project %s can edit without sharing the owning team", (role) => {
    expect(decideTicket(actor, ticket, context(role)).capabilities.can.edit).toEqual({ allowed: true });
});

test("archived projects refuse changes even for org admins but keep comments", () => {
    const decision = decideTicket({ ...actor, role: "super_admin" }, ticket, context("project_admin", true));
    expect(decision.capabilities.can.edit).toEqual({ allowed: false, reason: "PROJECT_ARCHIVED" });
    expect(decision.capabilities.can.comment).toEqual({ allowed: true });
    expect(decision.capabilities.can.logWorkForOthers).toEqual({ allowed: false, reason: "PROJECT_ARCHIVED" });
});

test("only project admins and org admins can log work for others", () => {
    expect(decideTicket(actor, ticket, context("project_admin")).capabilities.can.logWorkForOthers).toEqual({ allowed: true });
    expect(decideTicket(actor, ticket, context("member")).capabilities.can.logWorkForOthers).toEqual({ allowed: false, reason: "ACCESS_DENIED" });
    expect(decideTicket(actor, ticket, context(null)).capabilities.can.comment).toEqual({ allowed: false, reason: "ACCESS_DENIED" });
});
