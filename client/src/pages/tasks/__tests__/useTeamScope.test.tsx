/**
 * The team picker: super admin and above choose one team at a time. Its sprints
 * (and so its tabs and landing) follow the chosen team, and the choice is
 * remembered. Everyone else, HR admins included, is pinned to their own team.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const TEAMS = [{ id: 1, name: "Payments" }, { id: 2, name: "Platform" }];
vi.mock("../../../api/organization", () => ({
    getOrgTeams: vi.fn(async () => ({ data: TEAMS })),
}));

const { useTeamScope, TEAM_SCOPE_STORAGE_KEY } = await import("../hooks/useTeamScope");

const SPRINTS = [
    { id: 10, team_id: 1, status: "active" },
    { id: 20, team_id: 2, status: "planned" },
];

function wrapper({ children }: { children: React.ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function scope(role: string, teamId: number | null = 1) {
    const setSelectedSprintId = vi.fn();
    const hook = renderHook(
        () => useTeamScope({
            currentUser: { id: 5, role, team_id: teamId },
            availableSprints: SPRINTS,
            setSelectedSprintId,
        }),
        { wrapper },
    );
    return { ...hook, setSelectedSprintId };
}

describe("team scope", () => {
    beforeEach(() => localStorage.clear());

    test.each(["super_admin", "platform_admin"])("%s gets the picker, defaulting to their own team", async (role) => {
        const { result } = scope(role);
        expect(result.current.showTeamSwitcher).toBe(true);
        await waitFor(() => expect(result.current.selectedTeamId).toBe(1));
        expect(result.current.visibleSprints.map((s: any) => s.id)).toEqual([10]);
        expect(result.current.teamScopeParams).toEqual({ team_id: 1 });
        expect(result.current.effectiveTeamId).toBe(1);
    });

    test.each(["hr_admin", "manager", "employee"])("%s has no picker and stays on their team", (role) => {
        const { result } = scope(role, 2);
        expect(result.current.showTeamSwitcher).toBe(false);
        // HR admins are org-wide on the server, so they are pinned explicitly.
        expect(result.current.teamScopeParams).toEqual(role === "hr_admin" ? { team_id: 2 } : {});
        expect(result.current.effectiveTeamId).toBe(2);
        expect(result.current.visibleSprints.map((s: any) => s.id)).toEqual([20]);
    });

    test("an admin with no team defaults to the first team", async () => {
        const { result } = scope("super_admin", null);
        await waitFor(() => expect(result.current.selectedTeamId).toBe(1));
    });

    test("switching team narrows sprints and is remembered", async () => {
        const { result } = scope("super_admin");
        await waitFor(() => expect(result.current.selectedTeamId).toBe(1));
        act(() => result.current.setSelectedTeamId(2));
        expect(result.current.visibleSprints.map((s: any) => s.id)).toEqual([20]);
        expect(result.current.effectiveTeamId).toBe(2);
        expect(localStorage.getItem(TEAM_SCOPE_STORAGE_KEY)).toBe("2");

        const again = scope("super_admin");
        await waitFor(() => expect(again.result.current.selectedTeamId).toBe(2));
    });
});
