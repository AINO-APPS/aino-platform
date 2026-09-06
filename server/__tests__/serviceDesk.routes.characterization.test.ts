export {};

import express from "express";
const request = require("supertest");

let mockTenant: any = { id: 7, slug: "acme", org_name: "Acme" };
const mockMasterQuery = jest.fn();
const mockTenantQuery = jest.fn();
const mockDefaultTenantQuery = jest.fn();
const mockGetTenantPool = jest.fn();
const mockLoggerError = jest.fn();

jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = 11;
    req.tenant = mockTenant;
    req.tenantId = mockTenant?.id || null;
    req.db = { query: mockTenantQuery };
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userRole = "employee";
        req.userOrgId = 3;
        next();
    },
}));
jest.mock("../db", () => ({ masterQuery: (...args: any[]) => mockMasterQuery(...args) }));
jest.mock("../utils/tenantManager", () => ({
    getTenantPool: (...args: any[]) => mockGetTenantPool(...args),
}));
jest.mock("../utils/logger", () => ({
    logger: { error: (...args: any[]) => mockLoggerError(...args), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const serviceDeskRoutes = require("../routes/serviceDesk");

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use("/api/service-desk", serviceDeskRoutes);
    return app;
}

describe("service desk route characterization", () => {
    beforeEach(() => {
        mockTenant = { id: 7, slug: "acme", org_name: "Acme" };
        mockMasterQuery.mockReset();
        mockTenantQuery.mockReset();
        mockDefaultTenantQuery.mockReset();
        mockGetTenantPool.mockReset().mockResolvedValue({ query: mockDefaultTenantQuery });
        mockLoggerError.mockReset();
    });

    test("limits non-default tenants to their own tickets and clamps pagination", async () => {
        mockMasterQuery
            .mockResolvedValueOnce({ rows: [{ id: 1, db_name: "platform", db_host: "db", slug: "default" }] })
            .mockResolvedValueOnce({ rows: [{ count: "3" }] })
            .mockResolvedValueOnce({ rows: [{ id: 22, tenant_id: 7 }] });

        const res = await request(makeApp()).get("/api/service-desk/tickets?status=open&page=-4&per_page=999");

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ tickets: [{ id: 22, tenant_id: 7 }], total: 3, page: 1, perPage: 100 });
        expect(mockMasterQuery.mock.calls[1][0]).toContain("t.tenant_id = $1");
        expect(mockMasterQuery.mock.calls[1][1]).toEqual([7, "open"]);
        expect(mockMasterQuery.mock.calls[2][1]).toEqual([7, "open", 100, 0]);
    });

    test("denies cross-tenant ticket detail after loading only from the master database", async () => {
        mockMasterQuery
            .mockResolvedValueOnce({ rows: [{ id: 22, tenant_id: 8 }] })
            .mockResolvedValueOnce({ rows: [{ id: 1, db_name: "platform", db_host: "db", slug: "default" }] });

        const res = await request(makeApp()).get("/api/service-desk/tickets/22");

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: "Access denied" });
        expect(mockTenantQuery).not.toHaveBeenCalled();
    });

    test("validates ticket input before tenant or master database access", async () => {
        const res = await request(makeApp()).post("/api/service-desk/tickets").send({
            ticket_type: "not-a-type",
            title: "Broken integration",
        });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/invalid ticket type/i);
        expect(mockTenantQuery).not.toHaveBeenCalled();
        expect(mockMasterQuery).not.toHaveBeenCalled();
    });

    test("stores the ticket in master DB and treats backlog mirroring as best effort", async () => {
        mockTenantQuery.mockResolvedValue({
            rows: [{ id: 11, username: "reporter", full_name: "A Reporter", email: "a@example.test" }],
        });
        mockMasterQuery
            .mockResolvedValueOnce({ rows: [{ id: 31, tenant_id: 7, title: "Broken integration", priority: "critical" }] })
            .mockResolvedValueOnce({ rows: [{ id: 1, db_name: "platform", db_host: "db", slug: "default" }] });
        mockGetTenantPool.mockRejectedValue(new Error("default tenant unavailable"));

        const res = await request(makeApp()).post("/api/service-desk/tickets").send({
            ticket_type: "bug",
            title: "  Broken integration  ",
            description: "Details",
            priority: "critical",
        });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ id: 31, tenant_id: 7 });
        expect(mockTenantQuery).toHaveBeenCalledWith(expect.stringContaining("FROM users"), [11]);
        expect(mockMasterQuery.mock.calls[0][0]).toContain("INSERT INTO service_desk_tickets");
        expect(mockMasterQuery.mock.calls[0][1]).toEqual([7, 11, "A Reporter", "a@example.test", "bug", "Broken integration", "Details", "critical"]);
        expect(mockGetTenantPool).toHaveBeenCalledWith("platform", "db");
        expect(mockLoggerError).toHaveBeenCalledWith(
            expect.objectContaining({ err: expect.any(Error) }),
            "Failed to create backlog task for service desk ticket",
        );
    });

    test("prevents an owner from changing a ticket after work has started", async () => {
        mockMasterQuery
            .mockResolvedValueOnce({ rows: [{ id: 31, tenant_id: 7, submitted_by_user_id: 11, status: "acknowledged" }] })
            .mockResolvedValueOnce({ rows: [{ id: 1, db_name: "platform", db_host: "db", slug: "default" }] });

        const res = await request(makeApp()).patch("/api/service-desk/tickets/31").send({ title: "Changed" });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/still open/i);
        expect(mockMasterQuery).toHaveBeenCalledTimes(2);
    });
});