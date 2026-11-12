export {};

/**
 * Project ownership at the HTTP boundary.
 *
 * These tests keep project-scoped visibility and placement coverage while
 * asserting that retired team/schedule scopes are no longer used.
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
    1: {
        id: 1, org_id: ORG, user_id: 900, assigned_to: null,
        sprint_id: null, workflow_state_id: 7, title: "Team A ticket", description: null,
        priority: "medium", completed_at: null, is_blocked: false, story_points: null,
        work_item_type_id: null, project_id: 301, task_number: null, created_at: "2026-10-01",
    },
    2: {
        id: 2, org_id: ORG, user_id: 901, assigned_to: 900,
        sprint_id: null, workflow_state_id: 7, title: "Team B ticket", description: null,
        priority: "medium", completed_at: null, is_blocked: false, story_points: null,
        work_item_type_id: null, project_id: 303, task_number: null, created_at: "2026-10-01",
    },
    3: {
        id: 3, org_id: ORG, user_id: 2, assigned_to: null,
        sprint_id: null, workflow_state_id: 7, title: "Unowned", description: null,
        priority: "medium", completed_at: null, is_blocked: false, story_points: null,
        work_item_type_id: null, project_id: 303, task_number: null, created_at: "2026-10-01",
    },
};

const SPRINTS: Record<number, any> = {
    50: { id: 50, project_id: 301, org_id: ORG, name: "A sprint", end_date: "2026-11-01", status: "planned" },
    60: { id: 60, project_id: 302, org_id: ORG, name: "B sprint", end_date: "2026-11-01", status: "planned" },
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
    // Placement writes return the moved row.
    match = text.match(/^UPDATE tasks SET .* WHERE id = \$(\d+) RETURNING \*/);
    if (match) {
        const id = Number(params[Number(match[1]) - 1]);
        return { rows: TASKS[id] ? [{ ...TASKS[id] }] : [], rowCount: 1 };
    }
    if (/^\s*SELECT .* FROM tasks t\b/i.test(text) && /WHERE/.test(text)) {
        return { rows: [], rowCount: 0 };
    }
    if (/SELECT DISTINCT p\.id/.test(text)) {
        return { rows: [301, 302].map((id) => ({ id })), rowCount: 2 };
    }
    if (/SELECT id, is_archived, type, kanban_backlog_enabled FROM projects WHERE id = ANY\(\$1::int\[\]\)/.test(text)) {
        const ids = params[0] as number[];
        const rows = ids.map((id) => ({ id, type: "scrum", is_archived: false }));
        return { rows, rowCount: rows.length };
    }
    if (/SELECT id FROM projects WHERE org_id = \$1 AND origin_team_id = \$2/.test(text)) {
        const projectId = Number(params[1]) === TEAM_A ? 301 : Number(params[1]) === TEAM_B ? 303 : null;
        return { rows: projectId == null ? [] : [{ id: projectId }], rowCount: projectId == null ? 0 : 1 };
    }
    if (/^SELECT id FROM projects WHERE org_id = \$1$/.test(text)) {
        return { rows: [301, 302, 303].map((id) => ({ id })), rowCount: 3 };
    }
    if (/SELECT pm\.user_id, pm\.team_id, pm\.role/.test(text)) {
        const projectId = Number(params[0]);
        const userId = Number(params[1]);
        const grants = userId === 1 && [301, 302].includes(projectId)
            ? [{ user_id: 1, team_id: null, role: "member" }]
            : [];
        return { rows: grants, rowCount: grants.length };
    }
    match = text.match(/FROM users WHERE id = \$1/);
    if (/SELECT id, team_id FROM users WHERE id = ANY/.test(text)) {
        const users = (params[0] as number[]).map((id) => USERS[id]).filter(Boolean);
        return { rows: users, rowCount: users.length };
    }
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
    if (/FROM sprints/.test(text)) {
        const id = Number(params[0]);
        const sprint = SPRINTS[id];
        return { rows: sprint ? [{ ...sprint }] : [], rowCount: sprint ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
}

const mockDb = {
    query: jest.fn((sql: string, params: unknown[]) => Promise.resolve(fixtureQuery(sql, params))),
    transaction: jest.fn(async (fn: any) => fn({
        query: (sql: string, params: unknown[]) => Promise.resolve(fixtureQuery(sql, params)),
    }, { afterCommit: (cb: any) => cb() })),
};

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
        req.tenant = { id: 1, plan: "enterprise", features: { agile: true } };
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
    test("a member's backlog is scoped to accessible projects", async () => {
        const res = await get("/api/tasks/backlog", asMember());
        expect(res.status).toBe(200);
        const list = queries.find((q) => /FROM tasks t/.test(q.sql));
        expect(list!.sql).toContain("t.project_id = ANY($");
        expect(list!.sql).toContain("t.user_id = $");
        expect(list!.sql).toContain("t.assigned_to = $");
        expect(list!.params).toContainEqual([301, 302]);
        expect(list!.sql).not.toMatch(/t\.team_id\b/);
    });

    test.each(["team_id=10", "unassigned=1"])("%s is rejected on project list reads", async (query) => {
        const res = await get(`/api/tasks?${query}`, asMember());
        expect(res.status).toBe(400);
    });

    test("an org admin sees all project tickets without a team predicate", async () => {
        await get("/api/tasks/backlog", asAdmin());
        const list = queries.find((q) => /FROM tasks t/.test(q.sql));
        expect(list!.sql).not.toMatch(/t\.team_id\b/);
    });
});

describe("project-owned direct ticket visibility", () => {
    test("a project viewer and reporter/assignee can read; a user without access cannot", async () => {
        const viewer = await get("/api/tasks/1/detail", asMember());
        expect(viewer.status).toBe(200);

        const reporter = await get("/api/tasks/1/detail", asMember({ "x-user-id": "900" }));
        expect(reporter.status).toBe(200);

        const assignee = await get("/api/tasks/2/detail", asMember({ "x-user-id": "900" }));
        expect(assignee.status).toBe(200);

        const outsider = await get("/api/tasks/3/detail", asMember());
        expect(outsider.status).toBe(403);
    });
});

describe("project-owned policy surfaces", () => {
    test("search, dependency lookup, notes picker and export share the project predicate", async () => {
        await get("/api/tasks/search?q=refund", asMember({ "x-project-ownership": "on" }));
        await get("/api/tasks/lookup/quicksearch?q=ref", asMember({ "x-project-ownership": "on" }));
        await get("/api/notes/search-tasks?q=ref", asMember({ "x-project-ownership": "on" }));
        await get("/api/export/my-tasks", asMember({ "x-project-ownership": "on" }));

        const searches = queries.filter((query) => /FROM tasks t/.test(query.sql));
        expect(searches).toHaveLength(4);
        for (const search of searches) {
            expect(search.sql).toContain("t.project_id = ANY($");
            expect(search.sql).toContain("t.user_id = $");
        }
    });
});

describe("detail and history", () => {
    test("a project member reads a ticket they did not create", async () => {
        const res = await get("/api/tasks/1/detail", asMember());
        expect(res.status).toBe(200);
    });

    test("a user without project access gets 403, not an empty-looking 404", async () => {
        const res = await get("/api/tasks/1/detail", asMember({ "x-user-id": "4" }));
        expect(res.status).toBe(403);
    });

    test("history follows the same boundary", async () => {
        const res = await get("/api/tasks/1/history", asMember({ "x-user-id": "4" }));
        expect(res.status).toBe(403);
    });

    test("comments and attachments follow the same boundary", async () => {
        const res = await get("/api/tasks/1/comments", asMember({ "x-user-id": "4" }));
        expect(res.status).toBe(403);
    });

    test("a reporter can read their project ticket without a project grant", async () => {
        const res = await get("/api/tasks/3/detail", asMember({ "x-team": "", "x-user-id": "2" }));
        expect(res.status).toBe(200);
    });

    test("a user without a project grant cannot read another user's ticket", async () => {
        const res = await get("/api/tasks/3/detail", asMember({ "x-team": "", "x-user-id": "1" }));
        expect(res.status).toBe(403);
    });
});

describe("status writes", () => {
    test("a project member may change status", async () => {
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

    test("a user without project access is refused", async () => {
        const res = await request(app)
            .patch("/api/tasks/1/status")
            .set(asMember({ "x-user-id": "4" }))
            .send({ workflow_state_id: 8 });
        expect(res.status).toBe(403);
    });
});

describe("sprint moves", () => {
    test("a ticket cannot join another project's sprint", async () => {
        const res = await request(app)
            .patch("/api/tasks/1/assign-sprint")
            .set(asAdmin())
            .send({ sprint_id: 60 });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("SPRINT_PROJECT_MISMATCH");
    });

    test("a ticket may join its own project's sprint", async () => {
        const res = await request(app)
            .patch("/api/tasks/1/assign-sprint")
            .set(asMember())
            .send({ sprint_id: 50 });
        expect(res.status).toBe(200);
    });

    test("a full update cannot move a ticket into another project's sprint", async () => {
        overrides.push({ match: /FROM sprints WHERE id = ANY/, rows: [] });
        const res = await request(app)
            .put("/api/tasks/1")
            .set(asAdmin())
            .send({ sprint_id: 60 });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("SPRINT_PROJECT_MISMATCH");
    });

    test("a bulk move reports the cross-project ticket as skipped", async () => {
        overrides.push({ match: /FROM sprints WHERE id = ANY/, rows: [] });
        const res = await request(app)
            .post("/api/tasks/bulk")
            .set(asAdmin())
            .send({ ids: [1], action: "move_to_sprint", value: 60 });
        expect(res.status).toBe(200);
        expect(res.body.changed).toBe(0);
        expect(res.body.results[0].ok).toBe(false);
        expect(res.body.results[0].error).toMatch(/own project/);
    });
});

describe("admin transfer", () => {
    test("the retired team transfer route is not found", async () => {
        const res = await request(app)
            .post("/api/tasks/1/transfer")
            .set(asMember())
            .send({ team_id: TEAM_B });
        expect(res.status).toBe(404);
    });
});

describe("sprint task list", () => {
    test("a user without project access gets 403", async () => {
        const res = await get("/api/sprints/50/tasks", asMember({ "x-user-id": "4" }));
        expect(res.status).toBe(403);
    });

    test("an org admin can read any project's sprint tasks", async () => {
        const res = await get("/api/sprints/50/tasks", asAdmin());
        expect(res.status).toBe(200);
    });

    test("a project member reads the sprint tasks through the policy", async () => {
        const res = await get("/api/sprints/50/tasks", asMember());
        expect(res.status).toBe(200);
        const list = queries.find((q) => /FROM tasks t/.test(q.sql));
        expect(list!.sql).toContain("t.project_id = $");
    });
});
