import { describe, expect, test, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getTasks = vi.fn();
vi.mock("../../../api/tasks", () => ({ getTasks: (...a: unknown[]) => getTasks(...a) }));

import SprintCancelledSection from "../SprintCancelledSection";

beforeEach(() => {
    vi.clearAllMocks();
});

describe("SprintCancelledSection", () => {
    test("asks for the sprint's cancelled tickets in scope and opens one from the collapsed list", async () => {
        getTasks.mockResolvedValue({
            data: { tasks: [{ id: 13, issue_key: "DEV-13", title: "Dropped idea", workflow_state_key: "cancelled" }] },
        });
        const onOpenDetail = vi.fn();

        render(<SprintCancelledSection sprintId={4} scopeParams={{ team_id: 2 }} onOpenDetail={onOpenDetail} />);

        const toggle = await screen.findByRole("button", { name: /Cancelled/ });
        expect(getTasks).toHaveBeenCalledWith(undefined, { team_id: 2, sprint_id: 4, status: "cancelled" });
        expect(toggle).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByText("Dropped idea")).toBeNull();

        fireEvent.click(toggle);
        fireEvent.click(screen.getByText("Dropped idea"));

        expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ id: 13 }));
    });

    test("renders nothing when the sprint has no cancelled tickets", async () => {
        getTasks.mockResolvedValue({ data: { tasks: [] } });

        const { container } = render(<SprintCancelledSection sprintId={4} onOpenDetail={vi.fn()} />);

        await waitFor(() => expect(getTasks).toHaveBeenCalled());
        expect(container).toBeEmptyDOMElement();
    });
});
