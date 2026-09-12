import { describe, expect, test, vi } from "vitest";

vi.mock("../AuthContext", () => ({
    isTenantlessPlatformAdmin: (user: any) =>
        user?.role === "platform_admin" && user?.tenant_id == null,
    currentRealm: () => "tenant",
    realmHomePath: (realm = "tenant") => realm === "platform" ? "/tenants" : "/",
    useAuth: vi.fn(),
}));

import { canMountTenantPage, realmBoundaryRedirect } from "../components/common/KeepAlive";

describe("tenantless keep-alive boundary", () => {
    const platformAdmin = { id: 1, role: "platform_admin", tenant_id: null };

    test("allows the platform console", () => {
        expect(canMountTenantPage(platformAdmin, "/tenants")).toBe(true);
    });

    test.each(["/", "/calendar", "/tasks", "/notes", "/chat", "/attendance", "/admin", "/manager"])(
        "does not mount tenant page %s",
        (path) => expect(canMountTenantPage(platformAdmin, path)).toBe(false),
    );

    test("allows tenant users and platform impersonation sessions", () => {
        expect(canMountTenantPage({ id: 2, role: "employee", tenant_id: 9 }, "/tasks")).toBe(true);
        expect(canMountTenantPage({ id: 1, role: "platform_admin", tenant_id: 9 }, "/tasks")).toBe(true);
    });
});

describe("realm landing boundary", () => {
    test("redirects the console root to the platform tenant list", () => {
        expect(realmBoundaryRedirect("/", "platform", true)).toBe("/tenants");
    });

    test("keeps the platform tenant list and tenant app home in their own realms", () => {
        expect(realmBoundaryRedirect("/tenants", "platform", true)).toBeNull();
        expect(realmBoundaryRedirect("/", "tenant", true)).toBeNull();
        expect(realmBoundaryRedirect("/tenants", "tenant", true)).toBe("/");
    });
});