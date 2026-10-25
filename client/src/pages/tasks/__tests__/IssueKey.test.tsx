import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import IssueKey from "../IssueKey";

describe("IssueKey", () => {
    beforeEach(() => {
        Object.assign(navigator, {
            clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
        });
    });

    test("shows the canonical key", () => {
        render(<IssueKey task={{ id: 7, issue_key: "PAY-142" }} />);
        expect(screen.getByText("PAY-142")).toBeTruthy();
    });

    test("falls back to the numeric id when there is no project", () => {
        render(<IssueKey task={{ id: 7, issue_key: null }} />);
        expect(screen.getByText("#7")).toBeTruthy();
    });

    test("copying the key is one action", async () => {
        render(<IssueKey task={{ id: 7, issue_key: "PAY-142" }} />);
        fireEvent.click(screen.getByRole("button", { name: /Copy issue key PAY-142/ }));

        await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("PAY-142"));
    });

    test("the copy control is keyboard reachable", () => {
        render(<IssueKey task={{ id: 7, issue_key: "PAY-142" }} />);
        const button = screen.getByRole("button", { name: /Copy issue key/ });
        expect(button.tagName).toBe("BUTTON");
    });

    test("a denied clipboard does not break the row", async () => {
        Object.assign(navigator, {
            clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
        });
        render(<IssueKey task={{ id: 7, issue_key: "PAY-142" }} />);

        fireEvent.click(screen.getByRole("button", { name: /Copy issue key/ }));
        await waitFor(() => expect(screen.getByText("PAY-142")).toBeTruthy());
    });
});
