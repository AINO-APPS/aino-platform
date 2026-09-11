export {};

const mockQuery = jest.fn();
jest.mock("../db", () => ({ masterQuery: (...a: any[]) => mockQuery(...a) }));

import jwt from "jsonwebtoken";
const { createHandoff, consumeHandoff, createLoginChoice, consumeLoginChoice } = require("../services/realmHandoff");

beforeAll(() => { process.env.JWT_SECRET = "realm-handoff-test-secret-32-characters"; });
beforeEach(() => mockQuery.mockReset());

describe("realm handoff", () => {
    const claims = { source_realm: "tenant", target_realm: "platform", platform_user_id: 9, tenant_id: 1, tenant_user_id: 2 };

    it("mints a 30-second, audience-bound JWT after persisting its jti", async () => {
        mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
        const token = await createHandoff(claims);
        const decoded: any = jwt.verify(token, process.env.JWT_SECRET!, { audience: "realm-handoff" });
        expect(decoded).toMatchObject(claims);
        expect(decoded.exp - decoded.iat).toBe(30);
        expect(mockQuery.mock.calls[0][0]).toContain("INSERT INTO realm_handoffs");
    });

    it("atomically consumes exactly once", async () => {
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
        const token = await createHandoff(claims);
        mockQuery.mockResolvedValueOnce({ rows: [{ jti: "ok" }], rowCount: 1 });
        await expect(consumeHandoff(token, "platform")).resolves.toMatchObject(claims);
        const sql = String(mockQuery.mock.calls[1][0]);
        expect(sql).toContain("consumed_at IS NULL");
        expect(sql).toContain("expires_at > NOW()");
    });

    it("does not burn a ticket presented to the wrong host", async () => {
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
        const token = await createHandoff(claims);
        mockQuery.mockClear();
        await expect(consumeHandoff(token, "tenant")).resolves.toBeNull();
        expect(mockQuery).not.toHaveBeenCalled();
    });

    it("rejects replay when the atomic update returns no row", async () => {
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
        const token = await createHandoff(claims);
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
        await expect(consumeHandoff(token, "platform")).resolves.toBeNull();
    });
});

describe("login realm choice", () => {
    const claims = { platform_user_id: 9, tenant_id: 1, tenant_user_id: 2 };
    it("is 60-second, audience-bound and single-use", async () => {
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
        const token = await createLoginChoice(claims);
        const decoded: any = jwt.verify(token, process.env.JWT_SECRET!, { audience: "realm-choice" });
        expect(decoded.exp - decoded.iat).toBe(60);
        mockQuery.mockResolvedValueOnce({ rows: [{ jti: "ok" }], rowCount: 1 });
        await expect(consumeLoginChoice(token)).resolves.toMatchObject(claims);
        expect(String(mockQuery.mock.calls[1][0])).toContain("consumed_at IS NULL");
    });
});