export {};

/**
 * Team ownership at the HTTP boundary.
 *
 * The policy unit tests prove the decisions; these mount the real routers and
 * prove each surface actually uses them: list scope, detail/history denial,
 * status writes, cross-team sprint rejection, admin transfer, sprint task
 * lists and the team-deletion guard. The `team_visibility` flag is flipped per
 * request so "off restores the old behaviour" is exercised too.
 */

jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = Number(req.header("x-user-id") || 1);
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userRole = req.header("x-role") || "employee";
        req.userOrgId = Number(req.header("x-org") || 1);
        const team = req.header("x-team");
        req.userTeamId = team ? Number(team) : null;
        req.roleLevel = 1;
        next();
    },
    requireRole: () => (_req: any, _res: any, next: any) => next(),
    requireSameOrg: (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../middleware/tenant", () => ({
    requireTenant: (_req: any, _res: any, next: any) => next(),
    requireFeature: () => (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../utils/taskNotifications", () => ({
    emitTaskUpdated: jest.fn(),
    notifyTaskAssigned: jest.fn().mockResolvedValue(true),
}));
jest.mock("../realtime/fanout", () => ({
    notifyUser: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../redis", () => ({
    invalidateUserContext: jest.fn().mockResolvedValue(undefined),
    getActiveSprint: jest.fn().mockResolvedValue(null),
    setActiveSprint: jest.fn().mockResolvedValue(undefined),
    invalidateActiveSprint: jest.fn().mockResolvedValue(undefined),
}));

const express = require("express");
const request = require("supertest");

const ORG = 1;
const TEAM_A = 10;
const TEAM_B = 20;

const USERS: Record<number, any> = {
    1: { id: 1, org_id: ORG, team_id: TEAM_A, role: "employee", is_active: true, username: "me", full_name: "Me" },
    2: { id: 2, org_id: ORG, team_id: TEAM_B, role: "employee", is_active: true, username: "other", full_name: "Other" },
    900: { id: 900, org_id: ORG, team_id: TEAM_A, role: "employee", is_active: true, username: "creator", full_name: "Creator" },
    901: { id: 901, org_id: ORG, team_id: TEAM_B, role: "employee", is_active: true, username: "creatorb", full_name: "Creator B" },
};

const TASKS: Record<number, any> = {
    // Owned by TEAM_A, created by someone else.
    1: {
        id: 1, org_id: ORG, user_id: 900, assigned_to: null, team_id: TEAM_A,
        sprint_id: null, workflow_state_id: 7, title: "Team A ticket", description: null,
        priority: "medium", completed_at: null, is_blocked: false, story_points: null,
        work_item_type_id: null, project_id: null, task_number: null, created_at: "2026-10-01",
    },
    2: {
        id: 2, org_id: ORG, user_id: 901, assigned_to: null, team_id: TEAM_B,
        sprint_id: null, workflow_state_id: 7, title: "Team B ticket", description: null,
        priority: "medium", completed_at: null, is_blocked: false, story_points: null,
        work_item_type_id: null, project_id: null, task_number: null, created_at: "2026-10-01",
    },
    // A legacy row with no owning team, created by user 2.
    3: {
        id: 3, org_id: ORG, user_id: 2, assigned_to: null, team_id: null,
        sprint_id: null, workflow_state_id: 7, title: "Unowned", description: null,
        priority: "medium", completed_at: null, is_blocked: false, story_points: null,
        work_item_type_id: null, project_id: null, task_number: null, created_at: "2026-10-01",
    },
};

const SPRINTS: Record<number, any> = {
    50: { id: 50, team_id: TEAM_A, org_id: ORG, name: "A sprint", end_date: "2026-11-01", status: "planned" },
    60: { id: 60, team_id: TEAM_B, org_id: ORG, name: "B sprint", end_date: "2026-11-01", status: "planned" },
};

interface QueryCall { sql: string; params: unknown[] }
let queries: QueryCall[] = [];
let overrides: Array<{ match: RegExp; rows: any[] }> = [];

function normalise(sql: string): string {
    return sql.replace(/\s+/g, " ").trim();
}

function fixtureQuery(sql: string, params: unknown[] = []): { rows: any[]; rowCount: number } {
    const text = normalise(sql);
    queries.push({ sql: text, params });
    for (const override of overrides) {
        if (override.match.test(text)) return { rows: override.rows, rowCount: override.rows.length };
    }
    let match = text.match(/SELECT \* FROM tasks WHERE id = \$1/);
    if (match) {
        const task = TASKS[Number(params[0])];
        return { rows: task ? [{ ...task }] : [], rowCount: task ? 1 : 0 };
    }
    if (/FROM tasks WHERE id = ANY\(\$1::int\[\]\)/.test(text)) {
        const ids = params[0] as number[];
        return { rows: ids.map((id) => TASKS[id]).filter(Boolean), rowCount: ids.length };
    }
    if (/^\s*SELECT .* FROM tasks t\b/i.test(text) && /WHERE/.test(text)) {
        return { rows: [], rowCount: 0 };
    }
    match = text.match(/FROM users WHERE id = \$1/);
    if (match && /^SELECT/.test(text)) {
        const user = USERS[Number(params[0])];
        return { rows: user ? [{ ...user }] : [], rowCount: user ? 1 : 0 };
    }
    match = text.match(/FROM teams WHERE id = \$1/);
    if (match) {
        const team = Number(params[0]);
        return {
            rows: team === TEAM_A ? [{ id: TEAM_A, org_id: ORG, name: "Team A" }]
                : team === TEAM_B ? [{ id: TEAM_B, org_id: ORG, name: "Team B" }]
                    : [],
            rowCount: 1,
        };
    }
    if (/FROM sprints s JOIN teams t/.test(text) || /^\s*SELECT .* FROM sprints\b/i.test(text)) {
        const id = Number(params[0]);
        const sprint = SPRINTS[id];
        return { rows: sprint ? [{ ...sprint }] : [], rowCount: sprint ? 1 : 0 };
    }
    if (/FROM sprints WHERE team_id = \$1/.test(text)) {
        return { rows: [], rowCount: 0 };
    }
    const count = text.match(/COUNT\(\*\)::int AS c FROM (tasks|sprints) WHERE team_id = \$1/);
    if (count) {
        const row = overrides.find((o) => o.match.test(text));
        void row;
        return { rows: [{ c: 0 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
}

const mockDb = {
    query: jest.fn((sql: string, params: unknown[]) => Promise.resolve(fixtureQuery(sql, params))),
    transaction: jest.fn(async (fn: any) => fn({
        query: (sql: string, params: unknown[]) => Promise.resolve(fixtureQuery(sql, params)),
    })),
};

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
        const flag = req.header("x-flag") !== "off";
        req.tenant = { id: 1, plan: "enterprise", features: { team_visibility: flag, agile: true } };
        req.tenantId = 1;
        req.db = mockDb;
        req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        next();
    });
    app.use("/api/tasks", require("../routes/tasks"));
    app.use("/api/sprints", require("../routes/sprints"));
    app.use("/api/org", require("../routes/organization"));
    app.use("/api/notes", require("../routes/notes"));
    app.use("/api/export", require("../routes/export"));
    return app;
}

const app = makeApp();

function asMember(headers: Record<string, string> = {}) {
    return {
        "x-user-id": "1", "x-org": String(ORG), "x-team": String(TEAM_A),
        "x-role": "employee", ...headers,
    };
}

function asAdmin(headers: Record<string, string> = {}) {
    return {
        "x-user-id": "2", "x-org": String(ORG), "x-team": "", "x-role": "hr_admin", ...headers,
    };
}

function get(url: string, headers: Record<string, string>) {
    let call = request(app).get(url).set(headers);
    return call;
}

beforeEach(() => {
    queries = [];
    overrides = [];
    mockDb.query.mockClear();
});

describe("list visibility", () => {
    test("a member's backlog is scoped to the ticket's team", async () => {
        const res = await get("/api/tasks/backlog", asMember());
        expect(res.status).toBe(200);
        const list = queries.find((q) => /FROM tasks t/.test(q.sql));
        expect(list!.sql).toContain("t.team_id = $");
        expect(list!.sql).not.toContain("users WHERE team_id");
    });

    test("flag off restores the creator-team predicate", async () => {
        const res = await get("/api/tasks/backlog", asMember({ "x-flag": "off" }));
        expect(res.status).toBe(200);
        const list = queries.find((q) => /FROM tasks t/.test(q.sql));
        expect(list!.sql).toContain("t.user_id IN (SELECT id FROM users WHERE team_id = $");
    });

    test("an admin's backlog is org-wide by default and may switch teams", async () => {
        await get("/api/tasks/backlog", asAdmin());
        let list = queries.find((q) => /FROM tasks t/.test(q.sql));
        expect(list!.sql).not.toContain("t.team_id = $");

        queries = [];
        await get("/api/tasks/backlog?team_id=20", asAdmin());
        list = queries.find((q) => /FROM tasks t/.test(q.sql));
        expect(list!.sql).toContain("t.team_id = $");
        expect(list!.params).toContain(TEAM_B);
    });

    test("an admin may open the Unassigned bucket", async () => {
        await get("/api/tasks/backlog?unassigned=1", asAdmin());
        const list = queries.find((q) => /FROM tasks t/.test(q.sql));
        expect(list!.sql).toContain("t.team_id IS NULL");
    });

    test("a non-admin asking for another team is rejected", async () => {
        const res = await get("/api/tasks/backlog?team_id=20", asMember());
        expect(res.status).toBe(403);
    });

    test("the admin org view excludes legacy unowned rows", async () => {
        await get("/api/tasks/backlog", asAdmin());
        const list = queries.find((q) => /FROM tasks t/.test(q.sql));
        expect(list!.sql).toContain("t.team_id IS NOT NULL");
    });
});

describe("the policy is applied to every ticket surface", () => {
    test("task search", async () => {
        const res = await get("/api/tasks/search?q=refund", asMember());
        expect(res.status).toBe(200);
        const search = queries.find((q) => /FROM tasks t/.test(q.sql) && /ILIKE/.test(q.sql));
        expect(search!.sql).toContain("t.team_id = $");
    });

    test("the dependency quicksearch", async () => {
        const res = await get("/api/tasks/lookup/quicksearch?q=ref", asMember());
        expect(res.status).toBe(200);
        const search = queries.find((q) => /FROM tasks t/.test(q.sql) && /t\.id = \$\d+::int/.test(q.sql));
        expect(search!.sql).toContain("t.team_id = $");
    });

    test("the notes task picker", async () => {
        const res = await get("/api/notes/search-tasks?q=ref", asMember());
        expect(res.status).toBe(200);
        const search = queries.find((q) => /FROM tasks t/.test(q.sql));
        expect(search!.sql).toContain("t.team_id = $");
    });

    test("the task export", async () => {
        const res = await get("/api/export/my-tasks", asMember());
        expect(res.status).toBe(200);
        const search = queries.find((q) => /FROM tasks t/.test(q.sql));
        expect(search!.sql).toContain("t.team_id = $");
    });

    test("search, quicksearch, notes and export stay personal when the flag is off", async () => {
        await get("/api/tasks/search?q=refund", asMember({ "x-flag": "off" }));
        await get("/api/tasks/lookup/quicksearch?q=ref", asMember({ "x-flag": "off" }));
        await get("/api/notes/search-tasks?q=ref", asMember({ "x-flag": "off" }));
        await get("/api/export/my-tasks", asMember({ "x-flag": "off" }));

        const searches = queries.filter((q) => /FROM tasks t/.test(q.sql));
        expect(searches).toHaveLength(4);
        for (const search of searches) {
            expect(search.sql).toContain("t.user_id = $");
            expect(search.sql).not.toContain("t.team_id = $");
        }
    });
});

describe("detail and history", () => {
    test("a team member reads a ticket they did not create", async () => {
        const res = await get("/api/tasks/1/detail", asMember());
        expect(res.status).toBe(200);
    });

    test("a non-member gets 403, not an empty-looking 404", async () => {
        const res = await get("/api/tasks/1/detail", asMember({ "x-team": String(TEAM_B) }));
        expect(res.status).toBe(403);
    });

    test("history follows the same boundary", async () => {
        const res = await get("/api/tasks/1/history", asMember({ "x-team": String(TEAM_B) }));
        expect(res.status).toBe(403);
    });

    test("comments and attachments follow the same boundary", async () => {
        const res = await get("/api/tasks/1/comments", asMember({ "x-team": String(TEAM_B) }));
        expect(res.status).toBe(403);
    });

    test("a user without a team can still read their own legacy ticket", async () => {
        const res = await get("/api/tasks/3/detail", asMember({ "x-team": "", "x-user-id": "2" }));
        expect(res.status).toBe(200);
    });

    test("a user without a team cannot read an unowned ticket they do not own", async () => {
        const res = await get("/api/tasks/3/detail", asMember({ "x-team": "", "x-user-id": "1" }));
        expect(res.status).toBe(403);
    });

    test("flag off lets a creator's teammate read the ticket", async () => {
        const res = await get("/api/tasks/1/detail", asMember({ "x-flag": "off" }));
        expect(res.status).toBe(200);
    });
});

describe("status writes", () => {
    test("any owning-team member may change status", async () => {
        overrides.push({
            match: /FROM workflow_states/,
            rows: [{ id: 8, key: "in_progress", name: "In Progress", category: "in_progress", is_initial: false, is_terminal: false }],
        });
        const res = await request(app)
            .patch("/api/tasks/1/status")
            .set(asMember())
            .send({ workflow_state_id: 8 });
        expect(res.status).toBe(200);
    });

    test("a non-member is refused", async () => {
        const res = await request(app)
            .patch("/api/tasks/1/status")
            .set(asMember({ "x-team": String(TEAM_B) }))
            .send({ workflow_state_id: 8 });
        expect(res.status).toBe(403);
    });

    test("flag off keeps status changes to the assignee or reporter", async () => {
        overrides.push({
            match: /FROM workflow_states/,
            rows: [{ id: 8, key: "in_progress", name: "In Progress", category: "in_progress", is_initial: false, is_terminal: false }],
        });
        // User 1 is neither creator (900) nor assignee, but is on TEAM_A.
        const res = await request(app)
            .patch("/api/tasks/1/status")
            .set(asMember({ "x-flag": "off" }))
            .send({ workflow_state_id: 8 });
        expect(res.status).toBe(403);
    });
});

describe("sprint moves", () => {
    test("a ticket cannot join another team's sprint", async () => {
        const res = await request(app)
            .patch("/api/tasks/1/assign-sprint")
            .set(asAdmin())
            .send({ sprint_id: 60 });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("SPRINT_TEAM_MISMATCH");
    });

    test("a ticket may join its own team's sprint", async () => {
        const res = await request(app)
            .patch("/api/tasks/1/assign-sprint")
            .set(asMember())
            .send({ sprint_id: 50 });
        expect(res.status).toBe(200);
    });

    test("a full update cannot move a ticket into another team's sprint", async () => {
        overrides.push({ match: /FROM sprints WHERE id = ANY/, rows: [] });
        const res = await request(app)
            .put("/api/tasks/1")
            .set(asAdmin())
            .send({ sprint_id: 60 });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("SPRINT_TEAM_MISMATCH");
    });

    test("a bulk move reports the cross-team ticket as skipped", async () => {
        overrides.push({ match: /FROM sprints WHERE id = ANY/, rows: [] });
        const res = await request(app)
            .post("/api/tasks/bulk")
            .set(asAdmin())
            .send({ ids: [1], action: "move_to_sprint", value: 60 });
        expect(res.status).toBe(200);
        expect(res.body.changed).toBe(0);
        expect(res.body.results[0].ok).toBe(false);
        expect(res.body.results[0].error).toMatch(/another team/);
    });
});

describe("admin transfer", () => {
    test("a non-admin cannot transfer", async () => {
        const res = await request(app)
            .post("/api/tasks/1/transfer")
            .set(asMember())
            .send({ team_id: TEAM_B });
        expect(res.status).toBe(403);
    });

    test("an admin transfers the ticket and clears a now-foreign sprint", async () => {
        overrides.push({
            match: /SELECT id, name, team_id FROM sprints WHERE id = \$1/,
            rows: [{ id: 50, name: "A sprint", team_id: TEAM_A }],
        });
        const res = await request(app)
            .post("/api/tasks/1/transfer")
            .set(asAdmin())
            .send({ team_id: TEAM_B });
        expect(res.status).toBe(200);
        expect(res.body.to_team_id).toBe(TEAM_B);
        const update = queries.find((q) => /UPDATE tasks SET team_id = \$1, sprint_id = \$2/.test(q.sql));
        expect(update!.params[1]).toBeNull();
        const history = queries.find((q) => /INSERT INTO task_history/.test(q.sql));
        expect(history!.params[2]).toBe("transferred");
    });
});

describe("team deletion guard", () => {
    test("a team that owns work cannot be deleted", async () => {
        overrides.push(
            { match: /COUNT\(\*\)::int AS c FROM tasks WHERE team_id = \$1/, rows: [{ c: 4 }] },
            { match: /COUNT\(\*\)::int AS c FROM sprints WHERE team_id = \$1/, rows: [{ c: 2 }] },
            { match: /SELECT \* FROM teams WHERE id = \$1 AND org_id = \$2/, rows: [{ id: TEAM_A, org_id: ORG, name: "Team A" }] },
        );
        const res = await request(app)
            .delete("/api/org/teams/10")
            .set(asAdmin());
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("TEAM_HAS_WORK");
        expect(res.body.tasks).toBe(4);
        expect(res.body.sprints).toBe(2);
    });
});

describe("sprint task list", () => {
    test("a member of another team gets 403", async () => {
        const res = await get("/api/sprints/50/tasks", asMember({ "x-team": String(TEAM_B) }));
        expect(res.status).toBe(403);
    });

    test("an org admin can read any team's sprint tasks", async () => {
        const res = await get("/api/sprints/50/tasks", asAdmin());
        expect(res.status).toBe(200);
    });

    test("a member reads their own team's sprint tasks through the policy", async () => {
        const res = await get("/api/sprints/50/tasks", asMember());
        expect(res.status).toBe(200);
        const list = queries.find((q) => /FROM tasks t/.test(q.sql));
        expect(list!.sql).toContain("t.team_id = $");
    });
});
