import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import boardFixture from "../../../../../contracts/fixtures/sprint-board.json";
import KanbanBoard from "../KanbanBoard";
import { reasonCopy } from "../ticketCapabilities";

vi.mock("../TaskCard", () => ({
    default: ({ task }: any) => <div data-testid={`ticket-${task.id}`}>{task.title}</div>,
}));
vi.mock("../../../hooks/useViewportWidth", () => ({ useIsPhone: () => false }));
vi.mock("../hooks/useSwipe", () => ({ useSwipe: () => ({}) }));

const states = [
    { id: 101, key: "todo", name: "To Do", category: "open", color: "#456" },
    { id: 102, key: "in_progress", name: "In Progress", category: "in_progress", color: "#789" },
];

function columnsFor(board: any) {
    return board.columns.map((column: any) => ({
        ...column,
        id: column.stateId,
        ...states.find((state) => state.id === column.stateId),
    }));
}

function renderBoard(board: any = boardFixture) {
    return render(
        <KanbanBoard
            tasks={board.tickets}
            columns={columnsFor(board)}
            drag={{
                draggingTaskId: board.tickets[0].id,
                dragOverCol: null,
                onDragStart: vi.fn(),
                onDragOver: vi.fn(),
                onDragCancel: vi.fn(),
                dropOnColumn: vi.fn(),
            }}
            onOpenDetail={vi.fn()}
            onOpenComments={vi.fn()}
        />,
    );
}

describe("server-driven sprint board", () => {
    test("renders the shared board fixture's tickets and server column counts", () => {
        renderBoard();

        expect(screen.getByText("To Do")).toBeInTheDocument();
        expect(screen.getByText("In Progress")).toBeInTheDocument();
        expect(screen.getByText("1 / 1")).toBeInTheDocument();
        expect(screen.getByText("0")).toBeInTheDocument();
        expect(screen.getByTestId("ticket-201")).toHaveTextContent("Review the release plan");
        expect(screen.queryByText("Cancelled")).toBeNull();
    });

    test("explains a full column using the server's accepting decision", () => {
        const fullBoard = {
            ...boardFixture,
            columns: boardFixture.columns.map((column) =>
                column.stateId === 102
                    ? { ...column, count: 1, limit: 1, accepting: false }
                    : column,
            ),
        };
        renderBoard(fullBoard);

        const target = screen.getByText("In Progress").closest("[data-column-key]")!;
        expect(target).toHaveAttribute("aria-disabled", "true");
        expect(target).toHaveAttribute("title", reasonCopy("WIP_EXCEEDED"));
    });

    test("explains an illegal transition using the ticket capability reason", () => {
        const blockedBoard = {
            ...boardFixture,
            tickets: boardFixture.tickets.map((ticket) => ({
                ...ticket,
                capabilities: {
                    ...ticket.capabilities,
                    transitions: [{ to: 102, allowed: false, reason: "INVALID_TRANSITION" }],
                },
            })),
        };
        renderBoard(blockedBoard);

        const target = screen.getByText("In Progress").closest("[data-column-key]")!;
        expect(target).toHaveAttribute("aria-disabled", "true");
        expect(target).toHaveAttribute("title", reasonCopy("INVALID_TRANSITION"));
    });

    test("does not disable a target approved by both server decisions", () => {
        renderBoard();

        const target = screen.getByText("In Progress").closest("[data-column-key]")!;
        expect(target).not.toHaveAttribute("aria-disabled", "true");
        expect(target).not.toHaveAttribute("title", expect.anything());
    });

    test("fails closed when a ticket has no transition capabilities", () => {
        const oldPayload = {
            ...boardFixture,
            tickets: boardFixture.tickets.map(({ capabilities: _capabilities, ...ticket }) => ticket),
        };
        renderBoard(oldPayload);

        const target = screen.getByText("In Progress").closest("[data-column-key]")!;
        expect(target).toHaveAttribute("aria-disabled", "true");
        expect(target).toHaveAttribute(
            "title",
            "This action is unavailable. Refresh the ticket and try again.",
        );
    });
});
