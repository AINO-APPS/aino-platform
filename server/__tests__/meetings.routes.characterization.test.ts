export {};

import express from "express";
const request = require("supertest");

let mockFeatureAllowed = true;
let mockOrgId: number | null = 3;
const mockQuery = jest.fn();

jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = 11;
    req.tenantId = 7;
    req.log = { error: jest.fn(), warn: jest.fn() };
    next();
});
jest.mock("../middleware/tenant", () => ({
    requireTenant: (req: any, _res: any, next: any) => {
        req.tenant = { id: 7 };
        req.db = { query: mockQuery, transaction: jest.fn() };
        next();
    },
    requireFeature: () => (_req: any, res: any, next: any) => {
        if (!mockFeatureAllowed) return res.status(403).json({ code: "FEATURE_NOT_AVAILABLE" });
        next();
    },
}));
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userOrgId = mockOrgId;
        req.userRole = "employee";
        next();
    },
}));
jest.mock("../utils/ws", () => ({ sendToUser: jest.fn() }));
jest.mock("../utils/mailer", () => ({ notifyByEmail: jest.fn() }));
jest.mock("../redis", () => ({
    getMeetingParticipants: jest.fn(),
    setMeetingParticipants: jest.fn(),
    invalidateMeetingParticipants: jest.fn(),
}));
jest.mock("../utils/hlsBroadcast", () => ({ provisionBroadcast: jest.fn() }));
jest.mock("../services/pushNotifications", () => ({
    pushNotifications: { sendCallNotification: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock("../utils/meetingPermissions", () => ({
    ACTIONS: { ADD_PARTICIPANT: "add_participant", START_BROADCAST: "start_broadcast" },
    can: jest.fn(),
    listPresets: jest.fn(),
}));

const meetingRoutes = require("../routes/meetings");

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use("/api/meetings", meetingRoutes);
    return app;
}

describe("meeting route characterization", () => {
    beforeEach(() => {
        mockFeatureAllowed = true;
        mockOrgId = 3;
        mockQuery.mockReset();
    });

    test("gates meeting routes behind the tenant feature", async () => {
        mockFeatureAllowed = false;

        const res = await request(makeApp()).get("/api/meetings");

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ code: "FEATURE_NOT_AVAILABLE" });
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test("returns no conflicts for invalid input without database access", async () => {
        const res = await request(makeApp()).post("/api/meetings/check-conflicts").send({
            user_ids: [0, -1, "invalid"],
            start_time: "2026-09-07T09:00:00Z",
            end_time: "2026-09-07T10:00:00Z",
        });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ conflicts: [] });
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test("filters conflict checks to same-organization users and caps exposed events", async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 12 }] })
            .mockResolvedValueOnce({
                rows: [1, 2, 3, 4].map((id) => ({ user_id: 12, id, title: `Event ${id}`, start_time: "start", end_time: "end" })),
            })
            .mockResolvedValueOnce({ rows: [{ full_name: "Same Org User", username: "same-org" }] });

        const res = await request(makeApp()).post("/api/meetings/check-conflicts").send({
            user_ids: [12, 99],
            start_time: "2026-09-07T09:00:00Z",
            end_time: "2026-09-07T10:00:00Z",
        });

        expect(res.status).toBe(200);
        expect(res.body.conflicts).toEqual([{ userId: 12, name: "Same Org User", events: expect.any(Array) }]);
        expect(res.body.conflicts[0].events).toHaveLength(3);
        expect(mockQuery.mock.calls[0][1]).toEqual([[12, 99], 3]);
        expect(mockQuery.mock.calls[1][1]).toEqual([[12], "2026-09-07T09:00:00Z", "2026-09-07T10:00:00Z"]);
        expect(mockQuery).toHaveBeenCalledTimes(3);
    });

    test("lists only meetings organized by or shared with the caller in their organization", async () => {
        mockQuery.mockResolvedValue({ rows: [{ id: 8, meeting_code: "ABC-DEFG-HJK" }] });

        const res = await request(makeApp()).get("/api/meetings?status=scheduled&limit=25&offset=5");

        expect(res.status).toBe(200);
        expect(res.body).toEqual([{ id: 8, meeting_code: "ABC-DEFG-HJK" }]);
        expect(mockQuery.mock.calls[0][0]).toContain("WHERE m.org_id = $2");
        expect(mockQuery.mock.calls[0][0]).toContain("m.created_by = $1 OR EXISTS");
        expect(mockQuery.mock.calls[0][0]).toContain("AND m.status = $3");
        expect(mockQuery.mock.calls[0][1]).toEqual([11, 3, "scheduled", 25, 5]);
    });
});