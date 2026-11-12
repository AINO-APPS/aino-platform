export {};

const mockEmitTaskUpdated = jest.fn();
const mockNotifyUser = jest.fn().mockResolvedValue(undefined);

jest.mock("../utils/taskNotifications", () => ({ emitTaskUpdated: mockEmitTaskUpdated }));
jest.mock("../realtime/fanout", () => ({ notifyUser: mockNotifyUser }));

const { realtimeEffects } = require("../modules/tasks/tasks.placementEffects");

const ALICE = 1;
const BOB = 2;
const CAROL = 3;

function fakeDb(
    projectMembers: Record<number, number[]>,
    sprints: Record<number, { name: string; orgId?: number }>,
) {
    return {
        query: jest.fn(async (sql: string, params: unknown[]) => {
            if (/SELECT DISTINCT u\.id FROM users u/.test(sql)) {
                const ids = [...new Set(((params[0] as number[]) ?? []).flatMap((projectId) => projectMembers[projectId] ?? []))];
                return { rows: ids.map((id) => ({ id })), rowCount: ids.length };
            }
            if (sql.includes("FROM sprints")) {
                const sprint = sprints[Number(params[0])];
                const scoped = sql.includes("JOIN projects") && sql.includes("JOIN tasks");
                const rows = [sprint].filter((row) => row && (!scoped || (row.orgId ?? 1) === params[2]));
                return { rows, rowCount: rows.length };
            }
            throw new Error(`unexpected query: ${sql}`);
        }),
    };
}

const actor = { userId: ALICE, orgId: 1 };
const ticket = { id: 7, title: "Fix login", org_id: 1, project_id: 1, user_id: ALICE, assigned_to: BOB };

describe("realtime effects of a placement", () => {
    beforeEach(() => {
        mockEmitTaskUpdated.mockClear();
        mockNotifyUser.mockClear();
    });

    test("a ticket joining a sprint is broadcast to project members, and its assignee is told", async () => {
        const effects = realtimeEffects({ db: fakeDb({ 1: [CAROL] }, { 5: { name: "Sprint 5" } }), tenantId: 42 });

        await effects.changed({
            before: { ...ticket, sprint_id: null, due_date: "2026-11-20", planned_date: null },
            after: { ...ticket, sprint_id: 5, due_date: "2026-11-14", planned_date: null },
            actor,
        });

        expect(mockEmitTaskUpdated).toHaveBeenCalledWith(
            42, 7, "updated",
            expect.arrayContaining([BOB, ALICE, CAROL]),
        );
        expect(mockNotifyUser).toHaveBeenCalledTimes(1);
        expect(mockNotifyUser).toHaveBeenCalledWith(
            expect.anything(), 42, BOB, "sprint", "Added to Sprint 5", "Fix login was added to Sprint 5.",
            expect.objectContaining({ linkTaskId: 7, actorId: ALICE }),
        );
    });

    test("a ticket created straight into a sprint is broadcast without the sprint-added notification", async () => {
        const effects = realtimeEffects({ db: fakeDb({ 1: [ALICE] }, { 5: { name: "Sprint 5" } }), tenantId: 42, notify: false });

        await effects.changed({
            before: { ...ticket, sprint_id: null },
            after: { ...ticket, sprint_id: 5 },
            actor,
        });

        expect(mockEmitTaskUpdated).toHaveBeenCalledTimes(1);
        expect(mockNotifyUser).not.toHaveBeenCalled();
    });

    test("a ticket does not announce a sprint from another organization", async () => {
        const effects = realtimeEffects({
            db: fakeDb({ 1: [ALICE] }, { 5: { name: "Foreign sprint", orgId: 2 } }),
            tenantId: 42,
        });

        await effects.changed({
            before: { ...ticket, sprint_id: null },
            after: { ...ticket, sprint_id: 5 },
            actor,
        });

        expect(mockNotifyUser).not.toHaveBeenCalled();
    });

    test("leaving a sprint or changing a day is broadcast but notifies nobody", async () => {
        const effects = realtimeEffects({ db: fakeDb({ 1: [ALICE] }, {}), tenantId: 42 });

        await effects.changed({
            before: { ...ticket, sprint_id: 5, planned_date: "2026-11-05", due_date: "2026-11-14" },
            after: { ...ticket, sprint_id: null, planned_date: "2026-11-05", due_date: "2026-11-20" },
            actor,
        });

        expect(mockEmitTaskUpdated).toHaveBeenCalledWith(
            42, 7, "updated", expect.any(Array),
        );
        expect(mockNotifyUser).not.toHaveBeenCalled();
    });

    test("a project move reaches members of both projects", async () => {
        const effects = realtimeEffects({ db: fakeDb({ 1: [CAROL], 2: [BOB] }, {}), tenantId: 42 });

        await effects.changed({
            before: { ...ticket, project_id: 1, assigned_to: null, sprint_id: null },
            after: { ...ticket, project_id: 2, assigned_to: null, sprint_id: null },
            actor,
            projectOwnership: true,
        });

        const audience = mockEmitTaskUpdated.mock.calls[0][3];
        expect(audience).toEqual(expect.arrayContaining([CAROL, BOB]));
    });

    test("a project move invalidates both projects without including ticket data", async () => {
        const effects = realtimeEffects({ db: fakeDb({ 1: [99], 2: [CAROL, 4] }, {}), tenantId: 42 });
        await effects.changed({
            before: { ...ticket, project_id: 1, ticket_key: "SRC-7", workflow_state_id: 10 },
            after: { ...ticket, project_id: 2, ticket_key: "DEST-1", workflow_state_id: 20 },
            actor,
            projectOwnership: true,
        });
        expect(mockEmitTaskUpdated).toHaveBeenCalledWith(
            42, 7, "updated", expect.arrayContaining([ALICE, BOB, CAROL, 4]),
        );
        expect(mockEmitTaskUpdated.mock.calls[0][3]).toContain(99);
        expect(mockEmitTaskUpdated.mock.calls[0]).toHaveLength(4);
        expect(mockNotifyUser).not.toHaveBeenCalled();
    });
});
