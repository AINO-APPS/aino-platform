export {};

jest.mock("../redis", () => ({
    getUserContext: jest.fn().mockResolvedValue(null),
    setUserContext: jest.fn().mockResolvedValue(undefined),
    getOrgRolesMap: jest.fn().mockResolvedValue(null),
    setOrgRolesMap: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { loadUserContext } = require("../middleware/rbac");

describe("loadUserContext team memberships", () => {
    function makeRequest(query: jest.Mock) {
        return {
            req: { userId: 5, tenantId: 20, tenant: { id: 20 }, db: { query } } as any,
            res: { status: jest.fn().mockReturnThis(), json: jest.fn() } as any,
            next: jest.fn(),
        };
    }

    test("loads every persisted team plus the legacy primary team for project access", async () => {
        const query = jest.fn(async (sql: string) => {
            if (sql.includes("SELECT role, org_id, team_id")) {
                return {
                    rows: [{
                        role: "employee", org_id: 7, team_id: 11,
                        department_id: null, manager_id: null, is_active: true,
                    }],
                    rowCount: 1,
                };
            }
            if (sql.includes("user_team_memberships")) {
                return { rows: [{ team_id: 11 }, { team_id: 12 }, { team_id: 13 }], rowCount: 3 };
            }
            throw new Error(`Unexpected query: ${sql}`);
        });
        const { req, res, next } = makeRequest(query);

        await loadUserContext(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.userTeamIds).toEqual([11, 12, 13]);
        expect(req.projectOwnership).toBe(true);
        expect(query.mock.calls.some(([sql]) => String(sql).includes("project_ownership"))).toBe(false);
    });

    test("refreshes persisted team memberships when the user context is cached", async () => {
        const query = jest.fn(async (sql: string) => {
            if (sql.includes("user_team_memberships")) {
                return { rows: [{ team_id: 11 }, { team_id: 13 }], rowCount: 2 };
            }
            throw new Error(`Unexpected query: ${sql}`);
        });
        const { req, res, next } = makeRequest(query);
        const { getUserContext } = require("../redis");
        getUserContext.mockResolvedValueOnce({
            role: "employee", org_id: 7, team_id: 11,
            department_id: null, manager_id: null, is_active: true,
        });

        await loadUserContext(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.userTeamIds).toEqual([11, 13]);
        expect(req.projectOwnership).toBe(true);
        expect(query.mock.calls.some(([sql]) => String(sql).includes("project_ownership"))).toBe(false);
    });
});
