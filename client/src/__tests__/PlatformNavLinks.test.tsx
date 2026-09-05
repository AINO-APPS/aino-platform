import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";

vi.mock("../AuthContext", () => ({
    isTenantlessPlatformAdmin: (user: any) =>
        user?.role === "platform_admin" && user?.tenant_id == null,
    useAuth: () => ({
        user: { id: 1, role: "platform_admin", tenant_id: null },
    }),
}));
vi.mock("../FeaturesContext", () => ({
    useFeatures: () => ({ hasFeature: () => true }),
}));
vi.mock("../ChatContext", () => ({
    useChatUnread: () => ({ unreadCount: 0 }),
}));
vi.mock("../components/common/KeepAlive", () => ({
    prefetchPage: vi.fn(),
}));

import NavLinks from "../components/navbar/NavLinks";

function LocationProbe() {
    const location = useLocation();
    return <output data-testid="location">{location.pathname}{location.search}</output>;
}

describe("tenantless platform navigation", () => {
    test("uses platform-console sections instead of tenant employee routes", async () => {
        const user = userEvent.setup();
        render(
            <MemoryRouter initialEntries={["/tenants"]}>
                <NavLinks />
                <LocationProbe />
            </MemoryRouter>,
        );

        expect(screen.queryByText("Calendar")).not.toBeInTheDocument();
        expect(screen.getByText("Tenants")).toBeInTheDocument();
        expect(screen.getByText("New Tenant")).toBeInTheDocument();

        await user.click(screen.getByText("Plans"));
        expect(screen.getByTestId("location")).toHaveTextContent("/tenants?tab=plans");
    });
});