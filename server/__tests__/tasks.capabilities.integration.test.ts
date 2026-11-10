import { Pool } from "pg";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { installPgTypeParsers } from "../platform/db/pgTypes";
import { decideTicket, decideTickets, loadTicketDecisionContext, type CapabilityReason, type DecisionTicket } from "../modules/tasks/tasks.capabilities";
import type { TaskActor } from "../modules/tasks/tasks.policy";
import { assertLifecycleMove, loadLifecycleContext } from "../modules/tasks/tasks.workflow";
import { findFrozenSprintIds } from "../modules/tasks/tasks.sprintLifecycle";
import { placeTickets, transferTicket } from "../modules/tasks/tasks.placement";
import { ticketActionConflict } from "../modules/tasks/tasks.writeGuards";
import { buildSprintBoardColumns } from "../modules/tasks/tasks.board";
import { findSprintBoardCounts } from "../modules/tasks/tasks.sprintRepository";
import { createProjectAccess } from "../modules/tasks/tasks.projectAccess";

installPgTypeParsers();
const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;
const member: TaskActor = { userId: 1, orgId: 1, teamId: 1, role: "employee", teamVisibility: true };
const allowed = { allowed: true };
const denied = (reason: string) => ({ allowed: false, reason });
const denialMessages: Record<CapabilityReason, string> = {
    READ_ONLY_ROLE: "Your project role allows reading and commenting only.",
    PROJECT_ARCHIVED: "This project is archived and its tickets are read-only.",
    ACCESS_DENIED: "Access denied",
    WORKLOG_CANCELLED: "Work cannot be logged on a cancelled ticket.",
    WORKLOG_FOR_OTHERS_DENIED: "Only an org admin can log work for another person.",
    SPRINT_FROZEN: "This sprint is completed and no longer accepts task changes.",
    CANCELLED_TERMINAL: "This ticket is cancelled and cannot change state.",
    INVALID_TRANSITION: "This ticket cannot perform that action in its current state.",
    IN_SPRINT: "This ticket is in a sprint. Take it out of the sprint before planning it onto a day.",
    SPRINT_PROJECT_MISMATCH: "A ticket may only join a sprint in its own project.",
};
const actors = [
    ["member in team", 1, 1, "employee", true],
    ["member outside team", 1, 2, "employee", false],
    ["member without team", 1, null, "employee", false],
    ["assignee in team", 3, 1, "employee", true],
    ["assignee outside team", 3, 2, "employee", false],
    ["assignee without team", 3, null, "employee", true],
    ["reporter in team", 2, 1, "employee", true],
    ["reporter outside team", 2, 2, "employee", false],
    ["reporter without team", 2, null, "employee", true],
    ["admin in team", 4, 1, "super_admin", true],
    ["admin outside team", 4, 2, "super_admin", true],
    ["admin without team", 4, null, "super_admin", true],
    ["HR admin in team", 4, 1, "hr_admin", true],
    ["HR admin outside team", 4, 2, "hr_admin", true],
    ["HR admin without team", 4, null, "hr_admin", true],
    ["platform admin in team", 4, 1, "platform_admin", true],
    ["platform admin outside team", 4, 2, "platform_admin", true],
    ["platform admin without team", 4, null, "platform_admin", true],
    ["manager in team", 1, 1, "manager", true],
    ["manager outside team", 1, 2, "manager", false],
    ["manager without team", 1, null, "manager", false],
    ["non-member", 5, 2, "employee", false],
    ["non-member without team", 5, null, "employee", false],
] as const;
const workflows = [
    ["To Do", 101, [102, 105]],
    ["In Progress", 102, [101, 103, 104, 105, 106]],
    ["In Review", 103, [102, 104, 105]],
    ["Done", 104, [102]],
    ["Cancelled", 105, []],
    ["Custom Testing", 106, [102, 103, 105]],
] as const;
const containers = [
    ["backlog", null, null, false],
    ["scheduled", null, "2026-11-03", false],
    ["sprint", 10, "2026-11-03", false],
    ["sprint", 11, null, false],
    ["sprint", 12, null, false],
    ["sprint", 13, null, true],
] as const;

postgresDescribe("ticket capabilities on PostgreSQL", () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;

    beforeAll(async () => {
        database = await createTestDatabase(databaseUrl!, "capabilities");
        pool = new Pool({ connectionString: database.url, max: 2 });
        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        const migrations = await require("../platform/db/migrations").runTenantMigrations(query, { label: "capabilities" });
        expect(migrations.failed).toEqual([]);
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Capabilities', 'capabilities')");
        await pool.query("INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Alpha'), (2, 1, 'Beta')");
        await pool.query(`INSERT INTO users (id, username, password, full_name, org_id, team_id) VALUES
            (1, 'member', 'x', 'Member', 1, 1), (2, 'reporter', 'x', 'Reporter', 1, 1),
            (3, 'assignee', 'x', 'Assignee', 1, 1),
            (4, 'admin', 'x', 'Admin', 1, 1), (5, 'outsider', 'x', 'Outsider', 1, 2)`);
        await pool.query(`INSERT INTO workflow_states
            (id, org_id, key, name, category, is_initial, is_terminal, is_active, sort_order, wip_limit) VALUES
            (101, 1, 'todo', 'To Do', 'open', TRUE, FALSE, TRUE, 1, NULL),
            (102, 1, 'progress', 'In Progress', 'in_progress', FALSE, FALSE, TRUE, 2, 1),
            (103, 1, 'review', 'In Review', 'in_review', FALSE, FALSE, TRUE, 3, NULL),
            (104, 1, 'done', 'Done', 'done', FALSE, TRUE, TRUE, 4, NULL),
            (105, 1, 'cancelled', 'Cancelled', 'done', FALSE, TRUE, TRUE, 5, NULL),
            (106, 1, 'testing', 'Custom Testing', 'in_review', FALSE, FALSE, TRUE, 6, NULL),
            (107, 1, 'retired', 'Retired', 'open', FALSE, FALSE, FALSE, 7, NULL)`);
        await pool.query(`INSERT INTO workflow_transitions (org_id, from_state_id, to_state_id) VALUES
            (1,101,102), (1,101,105),
            (1,102,101), (1,102,103), (1,102,104), (1,102,105), (1,102,106),
            (1,103,102), (1,103,104), (1,103,105), (1,104,102),
            (1,106,102), (1,106,103), (1,106,105)`);
        await pool.query(`INSERT INTO sprints (id, team_id, name, start_date, end_date, status) VALUES
            (10, 1, 'Planned', '2026-11-01', '2026-11-14', 'planned'),
            (11, 1, 'Active', '2026-11-15', '2026-11-28', 'active'),
            (12, 1, 'Paused', '2026-12-01', '2026-12-14', 'paused'),
            (13, 1, 'Completed', '2026-10-01', '2026-10-14', 'completed'),
            (20, 2, 'Other team', '2026-11-01', '2026-11-14', 'planned')`);
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await database?.drop();
    });

    test.each([
        ['employee', false], ['manager', false], ['hr_admin', true], ['super_admin', true], ['platform_admin', true],
    ])('%s has the server-decided capability to log for others', async (role, admin) => {
        const actor: TaskActor = { ...member, role: String(role) };
        const ticket = (await pool.query(`INSERT INTO tasks (title, user_id, org_id, team_id, workflow_state_id)
            VALUES ('Behalf capability', 2, 1, 1, 101) RETURNING *`)).rows[0];
        const context = await loadTicketDecisionContext(pool, actor, [ticket]);
        expect((decideTicket(actor, ticket, context).capabilities.can as any).logWorkForOthers)
            .toEqual(admin ? allowed : denied('WORKLOG_FOR_OTHERS_DENIED'));
    });

    test.each(actors)("%s has the edit-based logWork decision, including Done but excluding Cancelled", async (_name, userId, teamId, role, writable) => {
        const actor: TaskActor = { userId, teamId, role, orgId: 1, teamVisibility: true };
        for (const state of [101, 104, 105]) {
            const ticket = (await pool.query(`INSERT INTO tasks (title, user_id, assigned_to, org_id, team_id, workflow_state_id)
                VALUES ('Record effort', 2, 3, 1, 1, $1) RETURNING *`, [state])).rows[0];
            const context = await loadTicketDecisionContext(pool, actor, [ticket]);
            expect((decideTicket(actor, ticket, context).capabilities.can as any).logWork)
                .toEqual(!writable ? denied('ACCESS_DENIED') : state === 105 ? denied('WORKLOG_CANCELLED') : allowed);
            expect(decideTicket(actor, ticket, context).capabilities.can.canEditEstimate)
                .toEqual(!writable ? denied('ACCESS_DENIED') : state === 105 ? denied('WORKLOG_CANCELLED') : allowed);
        }
    });

    test("a deadline without a planned day stays in the backlog in both decision forms", async () => {
        const ticket = (await pool.query(`INSERT INTO tasks (title, user_id, org_id, team_id, due_date)
            VALUES ('Deadline only', 2, 1, 1, '2026-11-30') RETURNING *`)).rows[0];
        const context = await loadTicketDecisionContext(pool, member, [ticket]);

        expect(decideTicket(member, ticket, context).container).toBe("backlog");
        expect(decideTickets(member, [ticket], context)).toEqual([decideTicket(member, ticket, context)]);
    });

    test.each([
        ["personal admin", 1, null, "project_admin", true, true, false],
        ["personal member", 1, null, "member", true, true, false],
        ["personal viewer", 1, null, "viewer", false, true, false],
        ["team admin", 1, 1, "project_admin", true, true, false],
        ["team member", 1, 1, "member", true, true, false],
        ["team viewer", 1, 1, "viewer", false, true, false],
        ["reporter without a role", 2, null, null, false, true, false],
        ["assignee without a role", 3, null, null, false, true, false],
        ["org admin", 4, null, null, true, true, false],
        ["no access", 5, null, null, false, false, false],
        ["archived project", 1, null, "project_admin", false, true, true],
    ] as const)("ticket07 project actor table: %s", async (_label, userId, teamId, role, write, comment, archived) => {
        const project = (await pool.query("INSERT INTO projects (org_id, key, name, is_archived) VALUES (1, $1, 'Role matrix', $2) RETURNING id",
            [`R${userId}${teamId ?? 0}${role === "project_admin" ? "A" : role === "member" ? "M" : "V"}${archived ? "X" : "N"}`, archived])).rows[0];
        if (role) await pool.query(`INSERT INTO project_members (project_id, user_id, team_id, role) VALUES ($1, $2, $3, $4)`,
            [project.id, teamId == null ? userId : null, teamId, role]);
        const projectActor: TaskActor = {
            userId, orgId: 1, teamId, role: userId === 4 ? "hr_admin" : "employee", teamVisibility: true, projectOwnership: true,
            projectAccess: createProjectAccess(pool, { userId, orgId: 1, orgRole: userId === 4 ? "hr_admin" : "employee", teamIds: teamId ? [teamId] : [] }),
        };
        const ticket = (await pool.query(`INSERT INTO tasks (title, user_id, assigned_to, org_id, project_id, workflow_state_id)
            VALUES ('Project actor', 2, 3, 1, $1, 101) RETURNING *`, [project.id])).rows[0];
        const decision = decideTicket(projectActor, ticket, await loadTicketDecisionContext(pool, projectActor, [ticket]));
        expect(decision.capabilities.can.edit.allowed).toBe(write);
        expect(decision.capabilities.can.comment.allowed).toBe(comment);
        expect(decision.capabilities.can.logWorkForOthers.allowed).toBe(write && (userId === 4 || role === "project_admin"));
        if (!write) expect(decision.capabilities.can.edit).toEqual(denied(archived ? "PROJECT_ARCHIVED" : comment ? "READ_ONLY_ROLE" : "ACCESS_DENIED"));
    });

    test("project-mode placement ignores team hints but refuses a different project's sprint with the shared message", async () => {
        const sprint = (await pool.query("SELECT project_id FROM sprints WHERE id = 10")).rows[0];
        const destination = (await pool.query("INSERT INTO projects (org_id, key, name) VALUES (1, 'CAPDEST', 'Another project') RETURNING id")).rows[0];
        await pool.query(`INSERT INTO sprints (id, team_id, project_id, name, start_date, end_date)
            VALUES (21, 2, $1, 'Other project', '2026-11-01', '2026-11-14')`, [destination.id]);
        const actor: TaskActor = { ...member, role: "super_admin", projectOwnership: true };
        const ticket = (await pool.query(`INSERT INTO tasks
            (title, user_id, org_id, team_id, project_id, workflow_state_id)
            VALUES ('Project placement', 2, 1, 2, $1, 101) RETURNING *`, [sprint.project_id])).rows[0];
        for (const [targetSprintId, permitted] of [[10, true], [21, false]] as const) {
            const context = await loadTicketDecisionContext(pool, actor, [ticket], { targetSprintId });
            expect(decideTicket(actor, ticket, context).capabilities.can.placeInSprint)
                .toEqual(permitted ? allowed : denied("SPRINT_PROJECT_MISMATCH"));
            if (!permitted) expect((await ticketActionConflict(pool, actor, ticket, "placeInSprint", context))?.body)
                .toEqual({ code: "SPRINT_PROJECT_MISMATCH", error: "A ticket may only join a sprint in its own project." });
        }
    });

    test("a team member sees every other active state and all ticket actions", async () => {
        const ticket = (await pool.query(`INSERT INTO tasks
            (title, user_id, assigned_to, org_id, team_id, workflow_state_id)
            VALUES ('Start work', 2, 3, 1, 1, 101) RETURNING *`)).rows[0];
        const context = await loadTicketDecisionContext(pool, member, [ticket]);

        expect(decideTicket(member, ticket, context)).toEqual({
            container: "backlog",
            capabilities: {
                transitions: [
                    { to: 102, allowed: true },
                    { to: 103, allowed: false, reason: "INVALID_TRANSITION" },
                    { to: 104, allowed: false, reason: "INVALID_TRANSITION" },
                    { to: 105, allowed: true },
                    { to: 106, allowed: false, reason: "INVALID_TRANSITION" },
                ],
                can: {
                    edit: { allowed: true },
                    logWork: { allowed: true },
                    logWorkForOthers: denied('WORKLOG_FOR_OTHERS_DENIED'),
                    canEditEstimate: { allowed: true },
                    changeState: { allowed: true },
                    cancel: { allowed: true },
                    canMoveProject: { allowed: false, reason: "ACCESS_DENIED" },
                    transfer: { allowed: false, reason: "ACCESS_DENIED" },
                    delete: { allowed: true },
                    placeInSprint: { allowed: true },
                    schedule: { allowed: true },
                    comment: { allowed: true },
                },
            },
        });
    });

    test.each([
        ["planned", 10, "IN_SPRINT"],
        ["active", 11, "IN_SPRINT"],
        ["paused", 12, "IN_SPRINT"],
        ["completed", 13, "SPRINT_FROZEN"],
    ])("a %s sprint wins over a planned day and blocks scheduling", async (_label, sprint, reason) => {
        const ticket = (await pool.query(`INSERT INTO tasks
            (title, user_id, org_id, team_id, workflow_state_id, sprint_id, planned_date)
            VALUES ('Sprint work', 2, 1, 1, 101, $1, '2026-11-03') RETURNING *`, [sprint])).rows[0];
        const context = await loadTicketDecisionContext(pool, member, [ticket]);
        const decision = decideTicket(member, ticket, context);

        expect(decision.container).toBe("sprint");
        expect(decision.capabilities.can.schedule).toEqual({ allowed: false, reason });
        if (sprint === 13) {
            expect(decision.capabilities.can.edit).toEqual({ allowed: false, reason: "SPRINT_FROZEN" });
            expect(decision.capabilities.transitions).toEqual([102, 103, 104, 105, 106].map((to) => ({
                to, allowed: false, reason: "SPRINT_FROZEN",
            })));
        }
    });

    describe.each(actors)("%s", (_label, userId, teamId, role, access) => {
        test.each(workflows)("%s across all containers and sprint statuses", async (_stateName, stateId, legalTargets) => {
            const actor: TaskActor = { ...member, userId, teamId, role };
            const tickets: DecisionTicket[] = [];
            for (const [, sprint, day] of containers) {
                tickets.push((await pool.query(`INSERT INTO tasks
                    (title, user_id, assigned_to, org_id, team_id, workflow_state_id, sprint_id, planned_date, due_date)
                    VALUES ('Matrix', 2, 3, 1, 1, $1, $2, $3, '2026-11-30') RETURNING *`,
                [stateId, sprint, day])).rows[0]);
            }
            const context = await loadTicketDecisionContext(pool, actor, tickets);
            const decisions = decideTickets(actor, tickets, context);
            const placementContext = await loadTicketDecisionContext(pool, actor, tickets,
                { targetSprintId: 10, lifecycle: context.lifecycle });

            for (const [index, [container, sprint, , frozen]] of containers.entries()) {
                const write = !access ? denied("ACCESS_DENIED") : frozen ? denied("SPRINT_FROZEN") : allowed;
                const status = stateId === 105 ? denied("CANCELLED_TERMINAL") : write;
                const cancel = !write.allowed ? write : stateId === 105 ? denied("CANCELLED_TERMINAL")
                    : stateId === 104 ? denied("INVALID_TRANSITION") : allowed;
                expect(decisions[index]).toEqual({
                    container,
                    capabilities: {
                        transitions: [101, 102, 103, 104, 105, 106].filter((to) => to !== stateId).map((to) => ({
                            to,
                            ...(!status.allowed ? status : (legalTargets as readonly number[]).includes(to)
                                ? allowed : denied("INVALID_TRANSITION")),
                        })),
                        can: {
                            edit: write,
                            logWork: !write.allowed ? write : stateId === 105 ? denied('WORKLOG_CANCELLED') : allowed,
                            logWorkForOthers: !['super_admin', 'hr_admin', 'platform_admin'].includes(role) ? denied('WORKLOG_FOR_OTHERS_DENIED')
                                : !write.allowed ? write : stateId === 105 ? denied('WORKLOG_CANCELLED') : allowed,
                            canEditEstimate: !write.allowed ? write : stateId === 105 ? denied('WORKLOG_CANCELLED') : allowed,
                            changeState: status,
                            cancel,
                            canMoveProject: denied("ACCESS_DENIED"),
                            transfer: ['super_admin', 'hr_admin', 'platform_admin'].includes(role) ? write : denied("ACCESS_DENIED"),
                            delete: cancel,
                            placeInSprint: write,
                            schedule: !write.allowed ? write : sprint == null ? allowed : denied("IN_SPRINT"),
                            comment: access ? allowed : denied("ACCESS_DENIED"),
                        },
                    },
                });
                expect(decideTicket(actor, tickets[index], context)).toEqual(decisions[index]);
                for (const action of ["edit", "logWork", "logWorkForOthers", "canEditEstimate", "changeState", "cancel", "delete", "transfer", "placeInSprint", "schedule"] as const) {
                    const verdict = decisions[index].capabilities.can[action];
                    const conflict = await ticketActionConflict(pool, actor, tickets[index], action, context);
                    expect(conflict?.body.code ?? null).toBe(verdict.allowed ? null : verdict.reason);
                    if (!verdict.allowed) {
                        expect(conflict?.status).toBe(['ACCESS_DENIED', 'WORKLOG_CANCELLED', 'WORKLOG_FOR_OTHERS_DENIED'].includes(verdict.reason) ? 403 : 409);
                        expect(conflict?.body.error).toBe(denialMessages[verdict.reason]);
                    }
                }

                if (frozen) {
                    expect(await findFrozenSprintIds(pool as any, [sprint!])).toEqual([13]);
                }
                {
                    for (const transition of decisions[index].capabilities.transitions) {
                        const conflict = await assertLifecycleMove(pool, 1, tickets[index],
                            context.lifecycle.stateById.get(transition.to), context.lifecycle, actor);
                        expect(conflict?.body.code ?? null).toBe(transition.allowed ? null : transition.reason);
                        if (!transition.allowed) expect(conflict?.status).toBe(transition.reason === "ACCESS_DENIED" ? 403 : 409);
                    }
                }
                {
                    const transaction = require("../platform/db/pool").makePoolTransaction(pool);
                    const results = await transaction((db: any, ctx: any) => placeTickets({
                        db, afterCommit: ctx.afterCommit, actor: { userId, orgId: 1 }, ticketActor: actor,
                        effects: { changed: () => undefined },
                    }, [tickets[index].id], { day: "2026-11-04" }));
                    const schedule = decisions[index].capabilities.can.schedule;
                    expect(results[0]).toMatchObject(schedule.allowed ? { ok: true } : { ok: false, code: schedule.reason });
                    if (!schedule.allowed) expect(results[0]).toMatchObject({ error: denialMessages[schedule.reason] });
                    const placement = decideTicket(actor, tickets[index], placementContext).capabilities.can.placeInSprint;
                    const placed = await transaction((db: any, ctx: any) => placeTickets({
                        db, afterCommit: ctx.afterCommit, actor: { userId, orgId: 1 }, ticketActor: actor,
                        effects: { changed: () => undefined },
                    }, [tickets[index].id], { sprint: 10 }));
                    expect(placed[0]).toMatchObject(placement.allowed ? { ok: true } : { ok: false, code: placement.reason });
                    if (!placement.allowed) expect(placed[0]).toMatchObject({ error: denialMessages[placement.reason] });
                    const transfer = decisions[index].capabilities.can.transfer;
                    const transferred = await transaction((db: any, ctx: any) => transferTicket({
                        db, afterCommit: ctx.afterCommit, actor: { userId, orgId: 1 }, ticketActor: actor,
                        effects: { changed: () => undefined },
                    }, tickets[index].id, 2));
                    expect(transferred).toMatchObject(transfer.allowed ? { ok: true } : { ok: false, code: transfer.reason });
                    if (!transfer.allowed) expect(transferred).toMatchObject({ error: denialMessages[transfer.reason] });
                }
            }
        });

    });

    test.each([
        ["own team's planned sprint", 10, true, undefined],
        ["completed destination", 13, false, "SPRINT_FROZEN"],
        ["another team's sprint", 20, false, "SPRINT_PROJECT_MISMATCH"],
        ["missing destination", 999, false, "ACCESS_DENIED"],
    ])("placing into %s uses the selected destination", async (_label, targetSprintId, permitted, reason) => {
            const actor = { ...member, role: "super_admin" };
            const ticket = (await pool.query(`INSERT INTO tasks (title, user_id, org_id, team_id, workflow_state_id)
                VALUES ('Place me', 2, 1, 1, 101) RETURNING *`)).rows[0];
            const context = await loadTicketDecisionContext(pool, actor, [ticket], { targetSprintId });
            const verdict = decideTicket(actor, ticket, context).capabilities.can.placeInSprint;
            expect(verdict).toEqual(permitted ? allowed : denied(reason!));
            if (!verdict.allowed) {
                expect((await ticketActionConflict(pool, actor, ticket, "placeInSprint", context))?.body)
                    .toEqual({ code: reason, error: denialMessages[verdict.reason] });
            }
            {
                const transaction = require("../platform/db/pool").makePoolTransaction(pool);
                const results = await transaction((db: any, ctx: any) => placeTickets({
                    db, afterCommit: ctx.afterCommit, actor: { userId: 1, orgId: 1 }, ticketActor: actor,
                    effects: { changed: () => undefined },
                }, [ticket.id], { sprint: targetSprintId }));
                expect(results[0]).toMatchObject(permitted ? { ok: true } : { ok: false, code: reason });
                if (!verdict.allowed) expect(results[0]).toMatchObject({ error: denialMessages[verdict.reason] });
            }
    });

    test.each([
        ["creator's teammate", 1, 1, "employee", true, false, false],
        ["assignee", 3, 1, "employee", true, true, false],
        ["reporter", 2, 1, "employee", true, true, true],
        ["admin", 4, 2, "super_admin", true, true, true],
        ["unrelated team", 1, 2, "employee", false, false, false],
        ["cross-team assignee", 3, 2, "employee", true, true, false],
    ] as const)("legacy visibility: %s agrees with existing access guards", async (_label, userId, teamId, role, edit, status, cancel) => {
        const actor: TaskActor = { ...member, userId, teamId, role, teamVisibility: false };
        const ticket = (await pool.query(`INSERT INTO tasks
            (title, user_id, assigned_to, org_id, team_id, workflow_state_id)
            VALUES ('Legacy owner', 2, 3, 1, 2, 101) RETURNING *`)).rows[0];
        const context = await loadTicketDecisionContext(pool, actor, [ticket]);
        const decision = decideTicket(actor, ticket, context);
        expect(decision.capabilities.can.edit).toEqual(edit ? allowed : denied("ACCESS_DENIED"));
        expect(decision.capabilities.can.changeState).toEqual(status ? allowed : denied("ACCESS_DENIED"));
        expect(decision.capabilities.can.cancel).toEqual(cancel ? allowed : denied("ACCESS_DENIED"));
        expect(decision.capabilities.can.delete).toEqual(cancel ? allowed : denied("ACCESS_DENIED"));
        expect(decision.capabilities.transitions.find((transition) => transition.to === 105))
            .toEqual({ to: 105, ...(cancel ? allowed : denied("ACCESS_DENIED")) });
        const guards = require("../routes/tasks/_helpers/access");
        expect(await guards.canAccessTask(ticket, actor, pool)).toBe(edit);
        expect(await guards.ticketActionConflict(pool, actor, ticket, "changeState", context))
            .toEqual(status ? null : expect.objectContaining({ status: 403, body: expect.objectContaining({ code: "ACCESS_DENIED" }) }));
        expect(await guards.ticketActionConflict(pool, actor, ticket, "cancel", context))
            .toEqual(cancel ? null : expect.objectContaining({ status: 403, body: expect.objectContaining({ code: "ACCESS_DENIED" }) }));
    });

    test("a custom completed ticket must reopen before cancellation", async () => {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query("UPDATE workflow_states SET is_terminal = TRUE WHERE id = 106");
            const ticket = (await client.query(`INSERT INTO tasks
                (title, user_id, org_id, team_id, workflow_state_id, completed_at)
                VALUES ('Custom completed', 2, 1, 1, 106, NOW()) RETURNING *`)).rows[0];
            const context = await loadTicketDecisionContext(client, member, [ticket]);
            const decision = decideTicket(member, ticket, context);
            expect(decision.capabilities.can.cancel).toEqual(denied("INVALID_TRANSITION"));
            expect(decision.capabilities.can.delete).toEqual(denied("INVALID_TRANSITION"));
            expect(decision.capabilities.transitions.find((transition) => transition.to === 105))
                .toEqual({ to: 105, ...denied("INVALID_TRANSITION") });
        } finally {
            await client.query("ROLLBACK");
            client.release();
        }
    });

    test("WIP capacity never disables a ticket transition, but the write guard still checks it", async () => {
        await pool.query(`INSERT INTO org_agile_settings (org_id, enable_wip_limits) VALUES (1, TRUE)
            ON CONFLICT (org_id) DO UPDATE SET enable_wip_limits = TRUE`);
        try {
            const tickets = (await pool.query(`INSERT INTO tasks
                (title, user_id, org_id, team_id, workflow_state_id)
                VALUES ('Waiting', 2, 1, 1, 101), ('Fills column', 2, 1, 1, 102) RETURNING *`)).rows;
            const lifecycle = await loadLifecycleContext(pool, 1, null);
            const context = await loadTicketDecisionContext(pool, member, tickets, { lifecycle });
            await pool.query("UPDATE org_agile_settings SET enable_wip_limits = FALSE WHERE org_id = 1");
            const withoutWip = await loadTicketDecisionContext(pool, member, tickets);
            expect(decideTickets(member, tickets, context)).toEqual(decideTickets(member, tickets, withoutWip));
            expect(decideTicket(member, tickets[0], context).capabilities.transitions).toEqual([
                { to: 102, allowed: true },
                { to: 103, allowed: false, reason: "INVALID_TRANSITION" },
                { to: 104, allowed: false, reason: "INVALID_TRANSITION" },
                { to: 105, allowed: true },
                { to: 106, allowed: false, reason: "INVALID_TRANSITION" },
            ]);
            expect(await assertLifecycleMove(pool, 1, tickets[0], lifecycle.stateById.get(102), lifecycle, member))
                .toMatchObject({ status: 409, body: { code: "WIP_EXCEEDED" } });
            expect(await assertLifecycleMove(pool, 1, tickets[0], withoutWip.lifecycle.stateById.get(102),
                withoutWip.lifecycle, member)).toBeNull();
            expect(await assertLifecycleMove(pool, 1, tickets[1], lifecycle.stateById.get(102), lifecycle, member)).toBeNull();
        } finally {
            await pool.query("UPDATE org_agile_settings SET enable_wip_limits = FALSE WHERE org_id = 1");
        }
    });

    test("board WIP status agrees with the PostgreSQL write guard and excludes Cancelled occupancy", async () => {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query("UPDATE workflow_states SET is_active = TRUE, sort_order = 8, wip_limit = 1 WHERE id = 107");
            await client.query(`INSERT INTO workflow_transitions (org_id, from_state_id, to_state_id)
                VALUES (1, 106, 107) ON CONFLICT (from_state_id, to_state_id) DO NOTHING`);
            await client.query(`INSERT INTO org_agile_settings (org_id, enable_wip_limits) VALUES (1, TRUE)
                ON CONFLICT (org_id) DO UPDATE SET enable_wip_limits = TRUE`);
            const tickets = (await client.query(`INSERT INTO tasks
                (title, user_id, org_id, team_id, workflow_state_id, sprint_id)
                VALUES ('Board source', 2, 1, 1, 106, 11),
                       ('Board target', 2, 1, 1, 107, NULL),
                       ('Board cancelled', 2, 1, 1, 105, 11)
                RETURNING *`)).rows;
            const lifecycle = await loadLifecycleContext(client, 1, null);
            const columns = buildSprintBoardColumns(lifecycle, await findSprintBoardCounts(client, 1));
            const targetColumn = columns.find((column) => column.stateId === 107);
            expect(targetColumn).toEqual({ stateId: 107, count: 1, limit: 1, accepting: false });
            expect(columns.some((column) => column.stateId === 105)).toBe(false);
            expect(await assertLifecycleMove(client, 1, tickets[0], lifecycle.stateById.get(107), lifecycle, member))
                .toMatchObject({ status: 409, body: { code: "WIP_EXCEEDED" } });

            await client.query("UPDATE org_agile_settings SET enable_wip_limits = FALSE WHERE org_id = 1");
            const disabledLifecycle = await loadLifecycleContext(client, 1, null);
            const disabledColumns = buildSprintBoardColumns(
                disabledLifecycle,
                await findSprintBoardCounts(client, 1),
            );
            expect(disabledColumns.find((column) => column.stateId === 107)?.accepting).toBe(true);
            expect(await assertLifecycleMove(client, 1, tickets[0], disabledLifecycle.stateById.get(107), disabledLifecycle, member))
                .toBeNull();
        } finally {
            await client.query("ROLLBACK");
            client.release();
        }
    });

    test("custom states without stored rows use the existing derived graph", async () => {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query("DELETE FROM workflow_transitions WHERE from_state_id = 106");
            const ticket = (await client.query(`INSERT INTO tasks
                (title, user_id, org_id, team_id, workflow_state_id)
                VALUES ('Derived custom', 2, 1, 1, 106) RETURNING *`)).rows[0];
            const context = await loadTicketDecisionContext(client, member, [ticket]);
            expect(decideTicket(member, ticket, context).capabilities.transitions).toEqual([
                { to: 101, allowed: false, reason: "INVALID_TRANSITION" },
                { to: 102, allowed: true },
                { to: 103, allowed: true },
                { to: 104, allowed: true },
                { to: 105, allowed: true },
            ]);
        } finally {
            await client.query("ROLLBACK");
            client.release();
        }
    });

    test("a loaded batch remains decidable after its database connection closes", async () => {
        const reader = new Pool({ connectionString: database.url, max: 1 });
        const tickets = (await reader.query(`INSERT INTO tasks
            (title, user_id, org_id, team_id, workflow_state_id)
            SELECT 'Batch ' || n, 2, 1, 1, 101 FROM generate_series(1, 20) n RETURNING *`)).rows;
        const context = await loadTicketDecisionContext(reader, member, tickets);
        await reader.end();

        const decisions = decideTickets(member, tickets, context);
        expect(decisions).toHaveLength(20);
        expect(decisions[0].capabilities.can.changeState).toEqual(allowed);
        expect(decideTickets(member, [], context)).toEqual([]);
    });
});
