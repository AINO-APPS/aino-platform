import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import EpicPanel from "../EpicPanel";

const epics = [
    {
        id: 1,
        title: "Payments",
        type_color: "#8b5cf6",
        rollup: {
            totalChildren: 4,
            doneChildren: 2,
            totalPoints: 20,
            donePoints: 8,
            percentByPoints: 40,
            percentByCount: 50,
        },
    },
    {
        id: 2,
        title: "Empty epic",
        rollup: {
            totalChildren: 0,
            doneChildren: 0,
            totalPoints: 0,
            donePoints: 0,
            percentByPoints: 0,
            percentByCount: 0,
        },
    },
];

describe("EpicPanel", () => {
    test("lists epics with completed against total in count and points", () => {
        render(<EpicPanel epics={epics} />);
        expect(screen.getByText("Payments")).toBeTruthy();
        expect(screen.getByText("2/4 · 8/20 pts")).toBeTruthy();
    });

    test("an epic with no children renders sensibly", () => {
        render(<EpicPanel epics={epics} />);
        expect(screen.getByText("Empty epic")).toBeTruthy();
        expect(screen.getByText("0/0 · 0/0 pts")).toBeTruthy();
    });

    test("selecting an epic filters the views", () => {
        const onSelectEpic = vi.fn();
        render(<EpicPanel epics={epics} onSelectEpic={onSelectEpic} />);

        fireEvent.click(screen.getByRole("button", { name: /Payments/ }));
        expect(onSelectEpic).toHaveBeenCalledWith(1);
    });

    test("selecting the active epic clears the filter", () => {
        const onSelectEpic = vi.fn();
        render(<EpicPanel epics={epics} selectedEpicId={1} onSelectEpic={onSelectEpic} />);

        fireEvent.click(screen.getByRole("button", { name: /Payments/ }));
        expect(onSelectEpic).toHaveBeenCalledWith(null);
    });

    test("no epics renders an empty state rather than an error", () => {
        render(<EpicPanel epics={[]} />);
        expect(screen.getByText("No epics yet.")).toBeTruthy();
    });
});
