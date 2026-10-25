import {
    WEBVIEW_CODE_TTL_SECONDS,
    consumeWebviewCode,
    createWebviewCode,
    isNativeClient,
} from "../services/webviewSession";

const masterQuery = jest.fn();

jest.mock("../db", () => ({
    masterQuery: (...args: unknown[]) => masterQuery(...args),
}));

describe("webview session exchange", () => {
    beforeEach(() => {
        masterQuery.mockReset().mockResolvedValue({ rows: [{ jti: "jti-1" }] });
        process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
    });

    test("a code expires within sixty seconds", async () => {
        const { code, expiresIn } = await createWebviewCode({
            userId: 7,
            tenantId: 3,
            realm: "tenant",
            issuedTo: "ios",
        });
        expect(expiresIn).toBe(WEBVIEW_CODE_TTL_SECONDS);
        expect(expiresIn).toBeLessThanOrEqual(60);
        expect(code).toBeTruthy();
        // The insert pins the same window in SQL.
        expect(masterQuery.mock.calls[0][0]).toContain("INTERVAL '60 seconds'");
    });

    test("the code carries no bearer token", async () => {
        const { code } = await createWebviewCode({
            userId: 7,
            tenantId: 3,
            realm: "tenant",
            issuedTo: "ios",
        });
        // A JWT payload is base64url; decode it and assert the token is absent.
        const payload = JSON.parse(
            Buffer.from(code.split(".")[1], "base64").toString("utf8"),
        );
        expect(payload).not.toHaveProperty("token");
        expect(payload).not.toHaveProperty("jwt");
        expect(Object.keys(payload).sort()).toEqual(
            ["aud", "exp", "iat", "issued_to", "jti", "realm", "tenant_id", "user_id"].sort(),
        );
    });

    test("a code is redeemed exactly once", async () => {
        const { code } = await createWebviewCode({
            userId: 7,
            tenantId: 3,
            realm: "tenant",
            issuedTo: "ios",
        });
        const first = await consumeWebviewCode(code, { expectedRealm: "tenant" });
        expect(first).toMatchObject({ user_id: 7, tenant_id: 3, realm: "tenant" });

        // The second redemption finds no unconsumed row.
        masterQuery.mockResolvedValueOnce({ rows: [] });
        expect(await consumeWebviewCode(code, { expectedRealm: "tenant" })).toBeNull();
    });

    test("a native client cannot redeem a code", async () => {
        const { code } = await createWebviewCode({
            userId: 7,
            tenantId: 3,
            realm: "tenant",
            issuedTo: "ios",
        });
        expect(await consumeWebviewCode(code, { presentedBy: "ios" })).toBeNull();
        expect(await consumeWebviewCode(code, { presentedBy: "android" })).toBeNull();
        expect(await consumeWebviewCode(code, { presentedBy: "desktop" })).toBeNull();
        // Nothing was consumed, so the webview can still redeem it.
        expect(await consumeWebviewCode(code, { presentedBy: "webview" })).not.toBeNull();
    });

    test("a code cannot cross realms", async () => {
        const { code } = await createWebviewCode({
            userId: 7,
            tenantId: 3,
            realm: "tenant",
            issuedTo: "ios",
        });
        expect(await consumeWebviewCode(code, { expectedRealm: "platform" })).toBeNull();
    });

    test("a malformed or foreign code is rejected", async () => {
        expect(await consumeWebviewCode("not-a-jwt")).toBeNull();
        expect(await consumeWebviewCode("")).toBeNull();
    });

    test("only native surfaces may request a code", () => {
        expect(isNativeClient("ios")).toBe(true);
        expect(isNativeClient("android")).toBe(true);
        expect(isNativeClient("desktop")).toBe(true);
        expect(isNativeClient("web")).toBe(false);
        expect(isNativeClient("webview")).toBe(false);
        expect(isNativeClient(null)).toBe(false);
        expect(isNativeClient(7)).toBe(false);
    });

    test("the redemption is an atomic single-use gate", async () => {
        const { code } = await createWebviewCode({
            userId: 7,
            tenantId: 3,
            realm: "tenant",
            issuedTo: "ios",
        });
        masterQuery.mockClear();
        await consumeWebviewCode(code, { expectedRealm: "tenant" });
        const sql = masterQuery.mock.calls[0][0] as string;
        expect(sql).toContain("consumed_at IS NULL");
        expect(sql).toContain("expires_at > NOW()");
    });
});
