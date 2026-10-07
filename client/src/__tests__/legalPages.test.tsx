import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test } from "vitest";
import PrivacyPolicy from "../pages/legal/PrivacyPolicy";
import TermsOfService from "../pages/legal/TermsOfService";
import AccountDeletion from "../pages/legal/AccountDeletion";
import { platformConsoleRouteRedirect } from "../AuthContext";

function renderPage(page: ReactElement) {
    return render(<MemoryRouter>{page}</MemoryRouter>);
}

describe("public legal pages", () => {
    test("privacy policy names the grievance contact and the on-device data", () => {
        renderPage(<PrivacyPolicy />);
        expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeTruthy();
        expect(screen.getAllByText(/privacy@aino\.org\.in/).length).toBeGreaterThan(0);
        expect(screen.getByText(/does not track location in the background/)).toBeTruthy();
    });

    test("terms link back to the privacy policy", () => {
        renderPage(<TermsOfService />);
        const links = screen.getAllByRole("link", { name: /Privacy Policy/ });
        expect(links.some((a) => a.getAttribute("href") === "/privacy")).toBe(true);
    });

    test("account deletion explains the in-app path and the email fallback", () => {
        renderPage(<AccountDeletion />);
        expect(screen.getByText("Delete My Account")).toBeTruthy();
        const mail = screen.getAllByRole("link").find((a) => a.getAttribute("href")?.startsWith("mailto:"));
        expect(mail?.getAttribute("href")).toContain("Account%20deletion%20request");
    });

    test("tenantless platform admins can open the legal pages", () => {
        const admin = { role: "platform_admin", tenant_id: null } as never;
        expect(platformConsoleRouteRedirect(admin, "/privacy")).toBeNull();
        expect(platformConsoleRouteRedirect(admin, "/account-deletion")).toBeNull();
        expect(platformConsoleRouteRedirect(admin, "/dashboard")).toBe("/tenants");
    });
});
