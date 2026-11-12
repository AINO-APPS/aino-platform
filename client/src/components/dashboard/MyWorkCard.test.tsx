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
import ticket from "../../../../contracts/fixtures/ticket-with-capabilities.json";

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

const currentUser = { id: 7 };
vi.mock("../../AuthContext", () => ({
    useAuth: () => ({ user: currentUser }),
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

describe("MyWorkCard stats", () => {
    test("shows the state breakdown of the same tickets it lists", async () => {
        hasFeature.mockReturnValue(false);
        const monday = nextMonday();
        getTasks.mockImplementation((_d: unknown, params: { start_date: string }) =>
            Promise.resolve({
                data: {
                    tasks: params.start_date === monday
                        ? [
                            { id: 1, title: "Writing", container: "backlog", assigned_to: 7, start_date: monday, workflow_state_category: "in_progress" },
                            { id: 2, title: "Shipped", container: "backlog", assigned_to: 7, start_date: monday, completed_at: "2026-11-02T10:00:00Z" },
                        ]
                        : [],
                },
            }),
        );

        renderCard();

        expect(await screen.findByText("1 of 2 done")).toBeInTheDocument();
        const cell = (label: string) => screen.getAllByText(label).find((node) => node.previousSibling)!.parentElement;
        expect(cell("In Progress")).toHaveTextContent("1In Progress");
        expect(cell("Done")).toHaveTextContent("1Done");
        expect(screen.getByRole("progressbar", { name: "My work progress" })).toHaveAttribute("aria-valuenow", "1");
    });
});

describe("MyWorkCard", () => {
    test("My Work groups dated tickets by start date independently of placement", async () => {
        hasFeature.mockReturnValue(false);
        getTasks.mockImplementation((_date: unknown, params: { start_date: string }) => Promise.resolve({ data: { tasks: params.start_date === nextMonday() ? [
            { ...ticket, id: 1, title: "Sprint start", assigned_to: 7, container: "sprint", start_date: nextMonday(), sprint_id: 999 },
            { ...ticket, id: 2, title: "Backlog start", assigned_to: 7, container: "backlog", start_date: nextMonday() },
            { ...ticket, id: 3, title: "Cleared date", assigned_to: 7, container: "backlog", start_date: null },
        ] : [] } }));
        renderCard();
        await screen.findByText("Sprint start");
        expect(screen.getByText("Backlog start")).toBeInTheDocument();
        expect(screen.queryByText("Cleared date")).not.toBeInTheDocument();
    });
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
                    { ...ticket, container: "sprint", id: 1, title: "Mine", assigned_to: 7, workflow_state_name: "In Progress" },
                    { ...ticket, container: "sprint", id: 2, title: "Theirs", assigned_to: 999 },
                    { ...ticket, container: "sprint", id: 3, title: "Cancelled", assigned_to: 7, workflow_state_key: "cancelled" },
                ],
            },
        });

        renderCard();

        await waitFor(() => expect(screen.getByText("Mine")).toBeInTheDocument());
        expect(screen.getByText("Sprint 12")).toBeInTheDocument();
        expect(screen.queryByText("Theirs")).not.toBeInTheDocument();
        expect(screen.queryByText("Cancelled")).not.toBeInTheDocument();
        // The workflow state's own name, not its category bucket (the stat row
        // also has an "In Progress" label, so read the row itself).
        expect(screen.getByText("Mine").parentElement).toHaveTextContent("In Progress");
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
            .mockResolvedValueOnce({ data: { tasks: [{ ...ticket, container: "backlog", id: 1, title: "This week", assigned_to: 7, start_date: nextMonday() }] } })
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
