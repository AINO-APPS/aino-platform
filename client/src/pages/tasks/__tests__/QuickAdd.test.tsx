import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import QuickAdd from "../QuickAdd";

describe("QuickAdd", () => {
    test("creates a task and keeps focus for the next one", async () => {
        const onCreate = vi.fn().mockResolvedValue(undefined);
        render(<QuickAdd onCreate={onCreate} />);

        const input = screen.getByLabelText("New ticket title") as HTMLInputElement;
        fireEvent.change(input, { target: { value: "Refund webhook" } });
        fireEvent.submit(input.closest("form")!);

        await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Refund webhook"));
        await waitFor(() => expect(input.value).toBe(""));
        expect(document.activeElement).toBe(input);
    });

    test("ignores an empty title", () => {
        const onCreate = vi.fn();
        render(<QuickAdd onCreate={onCreate} />);

        fireEvent.submit(screen.getByLabelText("New ticket title").closest("form")!);
        expect(onCreate).not.toHaveBeenCalled();
    });

    test("trims surrounding whitespace", async () => {
        const onCreate = vi.fn().mockResolvedValue(undefined);
        render(<QuickAdd onCreate={onCreate} />);

        const input = screen.getByLabelText("New ticket title");
        fireEvent.change(input, { target: { value: "  Ledger fix  " } });
        fireEvent.submit(input.closest("form")!);

        await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Ledger fix"));
    });

    test("the submit control is keyboard reachable", () => {
        render(<QuickAdd onCreate={vi.fn()} />);
        const button = screen.getByRole("button", { name: "Add" });
        expect(button.getAttribute("type")).toBe("submit");
    });
});
