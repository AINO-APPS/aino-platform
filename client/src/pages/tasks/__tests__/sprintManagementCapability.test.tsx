import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import SprintProgressCard from "../SprintProgressCard";

function renderCard(sprint: Record<string, unknown>, role = "employee") {
    render(
        <SprintProgressCard
            stats={{ done: 0, total: 0, percent: 0 }}
            sprintStats={null}
            features={{}}
            unitLabel="SP"
            availableSprints={[sprint]}
            selectedSprintId={sprint.id}
            currentUser={{ role }}
            getColTasks={() => []}
            onSprintChanged={() => undefined}
        />,
    );
}

describe("sprint management capability", () => {
    test("project members see lifecycle controls when the server grants permission", () => {
        renderCard({ id: 10, status: "planned", name: "Sprint 1", can_manage: true });

        expect(screen.getByRole("button", { name: /Start Sprint/ })).toBeTruthy();
    });

    test("server denial disables lifecycle controls even for a privileged legacy role", () => {
        renderCard({ id: 10, status: "planned", name: "Sprint 1", can_manage: false }, "team_lead");

        expect((screen.getByRole("button", { name: /Start Sprint/ }) as HTMLButtonElement).disabled).toBe(true);
    });

    test("legacy sprint responses retain role-based lifecycle controls", () => {
        renderCard({ id: 10, status: "planned", name: "Sprint 1" }, "team_lead");

        expect(screen.getByRole("button", { name: /Start Sprint/ })).toBeTruthy();
    });
});
