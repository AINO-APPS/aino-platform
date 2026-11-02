import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import ticket from "../../../../../contracts/fixtures/ticket-with-capabilities.json";
import TaskStatusControl from "../TaskStatusControl";
import BacklogCard from "../BacklogCard";
import BacklogBulkBar from "../BacklogBulkBar";
import TicketDetailActions from "../TicketDetailActions";
import TaskCard from "../TaskCard";
import { ToastProvider } from "../../../components/common/Toast";

vi.mock("../../../AgileConfigContext", () => ({
    useAgileConfig: () => ({
        features: {}, typeById: {}, unitLabel: "points",
        workflowStates: [
            { id: 101, key: "new", name: "New" },
            { id: 102, key: "in_progress", name: "In Progress" },
            { id: 103, key: "review", name: "Review" },
        ],
    }),
}));

describe("server capability rendering (web and desktop)", () => {
    test("detail lists exactly the fixture transitions, including denied targets and their reason", () => {
        const onChange = vi.fn();
        render(<TaskStatusControl task={ticket} currentUser={null} onChange={onChange} />);
        expect(screen.getAllByRole("button")).toHaveLength(2);
        const denied = screen.getByRole("button", { name: "New" });
        expect(denied).toBeDisabled();
        expect(denied).toHaveAttribute("title", "This workflow transition is not allowed.");
        fireEvent.click(denied);
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Review" }));
        expect(onChange).toHaveBeenCalledWith(ticket, { id: "103", label: "Review" });
    });

    test("card controls render denials and missing capabilities without local permission fallbacks", () => {
        const denied = {
            ...ticket,
            capabilities: {
                ...ticket.capabilities,
                can: {
                    ...ticket.capabilities.can,
                    edit: { allowed: false, reason: "ACCESS_DENIED" },
                    schedule: { allowed: false, reason: "IN_SPRINT" },
                    placeInSprint: { allowed: false, reason: "SPRINT_FROZEN" },
                },
            },
        };
        const props = {
            workflowStates: [],
            scheduleTaskId: null, scheduleDate: "", setScheduleTaskId: vi.fn(), setScheduleDate: vi.fn(),
            onOpenDetail: vi.fn(), onScheduleTask: vi.fn(), onInlineEdit: vi.fn(), onAddToSprint: vi.fn(),
        };
        const { rerender } = render(<BacklogCard task={denied} {...props} />);
        expect(screen.getByRole("button", { name: "Schedule to a day" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Schedule to a day" })).toHaveAttribute("title", "This ticket is in a sprint. Move it out before scheduling a day.");
        fireEvent.click(screen.getByRole("button", { name: "Actions for #42" }));
        expect(screen.getByRole("menuitem", { name: "Add to sprint" })).toBeDisabled();
        expect(screen.getByRole("menuitem", { name: "Edit title" })).toBeDisabled();
        rerender(<BacklogCard task={{ ...ticket, capabilities: undefined }} {...props} />);
        expect(screen.getByRole("button", { name: "Schedule to a day" })).toBeDisabled();
        expect(screen.getByRole("menuitem", { name: "Add to sprint" })).toBeDisabled();
    });

    test("bulk status lists fixture targets and names each ticket's denied actions", () => {
        render(<BacklogBulkBar
            bulk={{ count: 1, applying: false, selectedIds: [42], apply: vi.fn(), clear: vi.fn() }}
            tasks={[ticket]}
            availableSprints={[]} assignableUsers={[]} onOfferUndo={vi.fn()} onConfirmCancel={vi.fn()}
        />);
        expect(screen.getByRole("option", { name: "New" })).toBeDisabled();
        expect(screen.getByRole("option", { name: "Review" })).not.toBeDisabled();
        expect(screen.queryByRole("option", { name: "In Progress" })).toBeNull();
        fireEvent.click(screen.getByText("Per-ticket availability", { selector: "summary" }));
        expect(screen.getByRole("list", { name: "Per-ticket availability" })).toHaveTextContent(
            "Review the release plan",
        );
        expect(screen.getByRole("list", { name: "Per-ticket availability" })).toHaveTextContent(
            "This workflow transition is not allowed.",
        );
    });

    test("detail edit, cancel and transfer follow can and fail closed for an older payload", () => {
        const props = { onEdit: vi.fn(), onCancel: vi.fn(), onReplaced: vi.fn(), onError: vi.fn() };
        const { rerender } = render(<TicketDetailActions task={ticket} {...props} />);
        expect(screen.getByRole("button", { name: "Edit" })).not.toBeDisabled();
        expect(screen.getByRole("button", { name: "Cancel ticket" })).not.toBeDisabled();
        expect(screen.getByRole("button", { name: "Transfer to team" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Transfer to team" })).toHaveAttribute("title", "You do not have permission to do this.");
        rerender(<TicketDetailActions task={{ ...ticket, capabilities: undefined }} {...props} />);
        expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Cancel ticket" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Transfer to team" })).toBeDisabled();
    });

    test("the shared card menu renders the same fixture transitions as detail", () => {
        const change = vi.fn();
        render(<ToastProvider><TaskCard task={ticket} onOpenDetail={vi.fn()} onOpenComments={vi.fn()} onStatusChange={change} /></ToastProvider>);
        fireEvent.click(screen.getByRole("button", { name: "Actions for #42" }));
        expect(screen.getByRole("menuitem", { name: "New" })).toBeDisabled();
        fireEvent.click(screen.getByRole("menuitem", { name: "Review" }));
        expect(change).toHaveBeenCalledWith(ticket, { id: "103", label: "Review" });
    });
});
