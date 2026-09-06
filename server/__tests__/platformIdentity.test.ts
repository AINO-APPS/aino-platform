export {};

const requirePlatformIdentity = require("../middleware/platformIdentity");

function invoke(overrides: Record<string, unknown> = {}) {
    const req: any = { isPlatformUser: false, tenantId: null, ...overrides };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    requirePlatformIdentity(req, res, next);
    return { res, next };
}

describe("requirePlatformIdentity", () => {
    test("allows a tenantless master platform identity", () => {
        const { next } = invoke({ isPlatformUser: true, tenantId: null });
        expect(next).toHaveBeenCalledTimes(1);
    });

    test.each([
        [{ isPlatformUser: false, tenantId: null }],
        [{ isPlatformUser: false, tenantId: 7 }],
        [{ isPlatformUser: true, tenantId: 7 }],
    ])("rejects non-master or tenant-bound identities", (overrides) => {
        const { res, next } = invoke(overrides);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "PLATFORM_IDENTITY_REQUIRED" }));
        expect(next).not.toHaveBeenCalled();
    });
});