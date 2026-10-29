/**
 * The home card's behaviour at the component seam: which endpoints it calls and
 * what an empty week says.
 *
 * `myWork.test.ts` pins the filtering rules; these pin the promise the spec
 * makes about the *surface* — that the backlog is gone from home and that an
 * empty week says so instead of silently becoming a backlog list (spec D7).
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const getBacklog = vi.fn();
const getScheduled = vi.fn();
const getActiveSprint = vi.fn();
const getSprintTasks = vi.fn();
const getTasks = vi.fn();

vi.mock("../../api/tasks", () => ({
    getBacklog: (...a: unknown[]) => getBacklog(...a),
    getScheduled: (...a: unknown[]) => getScheduled(...a),
    getActiveSprint: (...a: unknown[]) => getActiveSprint(...a),
    getSprintTasks: (...a: unknown[]) => getSprintTasks(...a),
    getTasks: (...a: unknown[]) => getTasks(...a),
}));

const hasFeature = vi.fn();
vi.mock("../../FeaturesContext", () => ({
    useFeatures: () => ({ hasFeature }),
}));

vi.mock("../../AuthContext", () => ({
    useAuth: () => ({ user: { id: 7 } }),
}));

vi.mock("../../hooks/useWebSocket", () => ({ default: vi.fn() }));

import MyWorkCard from "./MyWorkCard";

/** The Monday of the current week, as the card computes it. */
function nextMonday(): string {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const pad = (n: number) => `${n}`.padStart(2, "0");
    return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

function renderCard() {
    return render(
        <MemoryRouter>
            <MyWorkCard />
        </MemoryRouter>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    getTasks.mockResolvedValue({ data: { tasks: [] } });
    getBacklog.mockResolvedValue({ data: { tasks: [{ id: 1, title: "Old backlog ticket" }] } });
    getScheduled.mockResolvedValue({ data: { tasks: [] } });
});

describe("MyWorkCard", () => {
    test("an empty week says so and never falls back to the backlog", async () => {
        hasFeature.mockReturnValue(true);
        getActiveSprint.mockResolvedValue({ data: { sprint: null } });

        renderCard();

        await waitFor(() => expect(screen.getByText("Nothing planned for this week.")).toBeInTheDocument());
        expect(getBacklog).not.toHaveBeenCalled();
        expect(getScheduled).not.toHaveBeenCalled();
        expect(screen.queryByText("Old backlog ticket")).not.toBeInTheDocument();
    });

    test("with the agile feature off it goes straight to the week, without asking for a sprint", async () => {
        hasFeature.mockReturnValue(false);

        renderCard();

        await waitFor(() => expect(getTasks).toHaveBeenCalled());
        expect(getActiveSprint).not.toHaveBeenCalled();
        expect(getBacklog).not.toHaveBeenCalled();
    });

    test("a running sprint lists only my tickets, with the sprint's name as the title", async () => {
        hasFeature.mockReturnValue(true);
        getActiveSprint.mockResolvedValue({ data: { sprint: { id: 12, name: "Sprint 12" } } });
        getSprintTasks.mockResolvedValue({
            data: {
                tasks: [
                    { id: 1, title: "Mine", assigned_to: 7, workflow_state_name: "In Progress" },
                    { id: 2, title: "Theirs", assigned_to: 999 },
                    { id: 3, title: "Cancelled", assigned_to: 7, workflow_state_key: "cancelled" },
                ],
            },
        });

        renderCard();

        await waitFor(() => expect(screen.getByText("Mine")).toBeInTheDocument());
        expect(screen.getByText("Sprint 12")).toBeInTheDocument();
        expect(screen.queryByText("Theirs")).not.toBeInTheDocument();
        expect(screen.queryByText("Cancelled")).not.toBeInTheDocument();
        // The workflow state's own name, not its category bucket.
        expect(screen.getByText("In Progress")).toBeInTheDocument();
        expect(getBacklog).not.toHaveBeenCalled();
    });

    test("a failed lookup says so instead of claiming the week is empty", async () => {
        hasFeature.mockReturnValue(true);
        getActiveSprint.mockResolvedValue({ data: { sprint: null } });
        getTasks.mockRejectedValue(new Error("offline"));

        renderCard();

        await waitFor(() => expect(screen.getByText("Could not load your tickets.")).toBeInTheDocument());
        expect(screen.queryByText("Nothing planned for this week.")).not.toBeInTheDocument();
    });

    test("a failed Overdue request still shows this week", async () => {
        hasFeature.mockReturnValue(true);
        getActiveSprint.mockResolvedValue({ data: { sprint: null } });
        getTasks
            .mockResolvedValueOnce({ data: { tasks: [{ id: 1, title: "This week", assigned_to: 7, planned_date: nextMonday() }] } })
            .mockRejectedValueOnce(new Error("overdue lookup failed"));

        renderCard();

        await waitFor(() => expect(screen.getByText("This week")).toBeInTheDocument());
    });

    test("the week request is a Monday-to-Sunday range scoped to me", async () => {
        hasFeature.mockReturnValue(true);
        getActiveSprint.mockResolvedValue({ data: { sprint: null } });

        renderCard();

        await waitFor(() => expect(getTasks).toHaveBeenCalledTimes(2));
        const [thisWeek, overdue] = getTasks.mock.calls.map((call) => call[1]);
        expect(thisWeek).toMatchObject({ assignee: "me" });
        expect(overdue).toMatchObject({ assignee: "me" });
        // 6 days apart, both plain `YYYY-MM-DD`.
        expect(thisWeek.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(thisWeek.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // The overdue lookup ends the day before this week starts.
        const end = new Date(`${thisWeek.start_date}T00:00:00`);
        end.setDate(end.getDate() - 1);
        expect(overdue.end_date).toBe(
            `${end.getFullYear()}-${`${end.getMonth() + 1}`.padStart(2, "0")}-${`${end.getDate()}`.padStart(2, "0")}`,
        );
    });
});
