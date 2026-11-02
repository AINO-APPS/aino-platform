import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import ticket from "../../../../../contracts/fixtures/ticket-with-capabilities.json";
import { getLocalToday } from "../../../api/client";
import { ToastProvider } from "../../../components/common/Toast";
import ScheduledTab from "../ScheduledTab";

vi.mock("../../../AgileConfigContext", () => ({
    useAgileConfig: () => ({ workflowStates: [], features: {}, typeById: {} }),
}));
vi.mock("../../../api/tasks", () => ({
    getScheduled: vi.fn(async () => ({ data: { tasks: [
        { ...ticket, title: "Server scheduled", container: "scheduled", planned_date: getLocalToday(), sprint_id: 99,
            capabilities: { ...ticket.capabilities, can: { ...ticket.capabilities.can, schedule: { allowed: false, reason: "IN_SPRINT" } } } },
        { ...ticket, id: 43, title: "Not scheduled", planned_date: getLocalToday(), container: "backlog" },
    ] } })),
    getBacklog: vi.fn(async () => ({ data: { tasks: [] } })),
    getScheduleOverlays: vi.fn(async () => ({ data: {} })),
}));

test("Scheduled membership and action availability render the fixture's server decisions", async () => {
    render(<ToastProvider><ScheduledTab onOpenDetail={vi.fn()} onOpenComments={vi.fn()} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    await screen.findAllByText("Server scheduled");
    expect(screen.queryByText("Not scheduled")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reschedule/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Back to backlog/ })).toBeDisabled();
});
