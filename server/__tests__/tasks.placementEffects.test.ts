export {};

const mockEmitTaskUpdated = jest.fn();
const mockNotifyUser = jest.fn().mockResolvedValue(undefined);

jest.mock("../utils/taskNotifications", () => ({ emitTaskUpdated: mockEmitTaskUpdated }));
jest.mock("../realtime/fanout", () => ({ notifyUser: mockNotifyUser }));

const { realtimeEffects } = require("../modules/tasks/tasks.placementEffects");

const ALICE = 1;
const BOB = 2;
const CAROL = 3;

function fakeDb(teamMembers: Record<number, number[]>, sprints: Record<number, { name: string }>) {
    return {
        query: jest.fn(async (sql: string, params: unknown[]) => {
            if (sql.includes("FROM users")) return { rows: (teamMembers[Number(params[0])] ?? []).map((id) => ({ id })), rowCount: 0 };
            if (sql.includes("FROM sprints")) return { rows: [sprints[Number(params[0])]].filter(Boolean), rowCount: 1 };
            throw new Error(`unexpected query: ${sql}`);
        }),
    };
}

const actor = { userId: ALICE, orgId: 1 };
const ticket = { id: 7, title: "Fix login", org_id: 1, team_id: 10, user_id: ALICE, assigned_to: BOB };

describe("realtime effects of a placement", () => {
    beforeEach(() => {
        mockEmitTaskUpdated.mockClear();
        mockNotifyUser.mockClear();
    });

    test("a ticket joining a sprint is broadcast to its people and team, and its assignee is told", async () => {
        const effects = realtimeEffects({ db: fakeDb({ 10: [ALICE, CAROL] }, { 5: { name: "Sprint 5" } }), tenantId: 42 });

        await effects.changed({
            before: { ...ticket, sprint_id: null, due_date: "2026-11-20", planned_date: null },
            after: { ...ticket, sprint_id: 5, due_date: "2026-11-14", planned_date: null },
            actor,
        });

        expect(mockEmitTaskUpdated).toHaveBeenCalledWith(
            42, 7, "updated",
            expect.arrayContaining([BOB, ALICE, CAROL]),
            { fields: { sprint_id: 5, due_date: "2026-11-14" }, actor: { id: ALICE, name: null } },
        );
        expect(mockNotifyUser).toHaveBeenCalledTimes(1);
        expect(mockNotifyUser).toHaveBeenCalledWith(
            expect.anything(), 42, BOB, "sprint", "Added to Sprint 5", "Fix login was added to Sprint 5.",
            expect.objectContaining({ linkTaskId: 7, actorId: ALICE }),
        );
    });

    test("leaving a sprint or changing a day is broadcast but notifies nobody", async () => {
        const effects = realtimeEffects({ db: fakeDb({ 10: [ALICE] }, {}), tenantId: 42 });

        await effects.changed({
            before: { ...ticket, sprint_id: 5, planned_date: "2026-11-05", due_date: "2026-11-14" },
            after: { ...ticket, sprint_id: null, planned_date: "2026-11-05", due_date: "2026-11-20" },
            actor,
        });

        expect(mockEmitTaskUpdated).toHaveBeenCalledWith(
            42, 7, "updated", expect.any(Array),
            { fields: { sprint_id: null, due_date: "2026-11-20" }, actor: { id: ALICE, name: null } },
        );
        expect(mockNotifyUser).not.toHaveBeenCalled();
    });

    test("a team transfer reaches both the old and the new team", async () => {
        const effects = realtimeEffects({ db: fakeDb({ 10: [CAROL], 20: [BOB] }, {}), tenantId: 42 });

        await effects.changed({
            before: { ...ticket, team_id: 10, assigned_to: null, sprint_id: null },
            after: { ...ticket, team_id: 20, assigned_to: null, sprint_id: null },
            actor,
        });

        const audience = mockEmitTaskUpdated.mock.calls[0][3];
        expect(audience).toEqual(expect.arrayContaining([CAROL, BOB]));
        expect(mockEmitTaskUpdated.mock.calls[0][4].fields).toEqual({ team_id: 20 });
    });
});
