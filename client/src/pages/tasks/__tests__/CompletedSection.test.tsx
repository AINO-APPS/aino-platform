import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CompletedSection from "../CompletedSection";

const tasks = [
    { id: 1, issue_key: "PAY-101", title: "Refund webhook", completed_at: "2026-10-20T10:00:00Z" },
    { id: 2, issue_key: "PAY-102", title: "Ledger fix", completed_at: "2026-10-21T10:00:00Z" },
];

const formatDate = (value: string | null | undefined) => (value ? value.slice(0, 10) : null);

describe("CompletedSection", () => {
    test("renders the count while collapsed without loading items", () => {
        render(
            <CompletedSection
                count={12}
                tasks={[]}
                open={false}
                loading={false}
                showingAll={false}
                onToggle={vi.fn()}
                onShowAll={vi.fn()}
                onOpenDetail={vi.fn()}
                formatDate={formatDate}
            />,
        );

        expect(screen.getByText("Completed")).toBeTruthy();
        expect(screen.getByText("(12)")).toBeTruthy();
        expect(screen.queryByText("Refund webhook")).toBeNull();
    });

    test("expanding reveals completed items and the escape hatch", () => {
        render(
            <CompletedSection
                count={12}
                tasks={tasks}
                open
                loading={false}
                showingAll={false}
                onToggle={vi.fn()}
                onShowAll={vi.fn()}
                onOpenDetail={vi.fn()}
                formatDate={formatDate}
            />,
        );

        expect(screen.getByText("Refund webhook")).toBeTruthy();
        expect(screen.getByText("View all completed")).toBeTruthy();
    });

    test("toggling calls back so the caller can load the window", () => {
        const onToggle = vi.fn();
        render(
            <CompletedSection
                count={3}
                tasks={[]}
                open={false}
                loading={false}
                showingAll={false}
                onToggle={onToggle}
                onShowAll={vi.fn()}
                onOpenDetail={vi.fn()}
                formatDate={formatDate}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: /Completed/ }));
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    test("hides the escape hatch once every completed item is shown", () => {
        render(
            <CompletedSection
                count={2}
                tasks={tasks}
                open
                loading={false}
                showingAll
                onToggle={vi.fn()}
                onShowAll={vi.fn()}
                onOpenDetail={vi.fn()}
                formatDate={formatDate}
            />,
        );

        expect(screen.queryByText("View all completed")).toBeNull();
    });

    test("renders nothing when there is no completed work", () => {
        const { container } = render(
            <CompletedSection
                count={0}
                tasks={[]}
                open={false}
                loading={false}
                showingAll={false}
                onToggle={vi.fn()}
                onShowAll={vi.fn()}
                onOpenDetail={vi.fn()}
                formatDate={formatDate}
            />,
        );

        expect(container.firstChild).toBeNull();
    });
});
