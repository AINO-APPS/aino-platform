import { describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTeamSwitchNavigation } from "../hooks/useTeamSwitchNavigation";

describe("team-switch navigation", () => {
    test("waits for the new team's current sprint and opens its paused sprint", () => {
        const goToView = vi.fn();
        type TeamSwitchProps = Parameters<typeof useTeamSwitchNavigation>[0];
        const initialProps: TeamSwitchProps = {
            selectedTeamId: 1,
            currentSprintId: 10,
            currentSprintLoaded: true,
            activeTab: "sprint",
            goToView,
        };
        const { rerender } = renderHook(
            (props: TeamSwitchProps) => useTeamSwitchNavigation(props),
            { initialProps },
        );

        rerender({
            selectedTeamId: 2,
            currentSprintId: null,
            currentSprintLoaded: false,
            activeTab: "sprint",
            goToView,
        });
        expect(goToView).not.toHaveBeenCalled();

        rerender({
            selectedTeamId: 2,
            currentSprintId: 21,
            currentSprintLoaded: true,
            activeTab: "sprint",
            goToView,
        });
        expect(goToView).toHaveBeenCalledWith("sprint", 21);
    });
});
