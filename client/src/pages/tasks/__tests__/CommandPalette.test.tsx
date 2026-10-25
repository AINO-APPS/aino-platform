import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CommandPalette from "../CommandPalette";
import ShortcutHelp, { TASK_SHORTCUTS } from "../ShortcutHelp";
import { buildPaletteItems, paletteViews } from "../hooks/useCommandPalette";

const searchTasks = vi.fn();

vi.mock("../../../api/tasks", () => ({
    searchTasks: (...args: unknown[]) => searchTasks(...args),
}));

beforeEach(() => {
    searchTasks.mockReset().mockResolvedValue({ data: [] });
});

const views = paletteViews("7");
const actions = [
    { id: "action-new-task", label: "New task", run: vi.fn() },
    { id: "action-toggle-completed", label: "Toggle completed", run: vi.fn() },
];

describe("buildPaletteItems", () => {
    test("tasks come first, then views, then actions", () => {
        const items = buildPaletteItems({
            query: "",
            tasks: [{ id: 1, title: "Refund webhook", issue_key: "PAY-142" }],
            views,
            actions,
            onOpenTask: vi.fn(),
            onGoToView: vi.fn(),
        });
        expect(items.map((item) => item.group)).toEqual([
            "tasks",
            "views",
            "views",
            "views",
            "views",
            "views",
            "actions",
            "actions",
        ]);
    });

    test("a query filters by title and by key", () => {
        const tasks = [
            { id: 1, title: "Refund webhook", issue_key: "PAY-142" },
            { id: 2, title: "Sprint board", issue_key: "WEB-7" },
        ];
        const byTitle = buildPaletteItems({
            query: "refund",
            tasks,
            views,
            actions,
            onOpenTask: vi.fn(),
            onGoToView: vi.fn(),
        });
        expect(byTitle.filter((i) => i.group === "tasks")).toHaveLength(1);

        const byKey = buildPaletteItems({
            query: "WEB-7",
            tasks,
            views,
            actions,
            onOpenTask: vi.fn(),
            onGoToView: vi.fn(),
        });
        expect(byKey.filter((i) => i.group === "tasks")).toHaveLength(1);
        expect(byKey[0].hint).toBe("WEB-7");
    });

    test("every view is reachable", () => {
        const items = buildPaletteItems({
            query: "",
            tasks: [],
            views,
            actions: [],
            onOpenTask: vi.fn(),
            onGoToView: vi.fn(),
        });
        expect(items.map((item) => item.label)).toEqual([
            "Backlog",
            "Sprint board",
            "Sprint plan",
            "Schedule",
            "Service desk",
        ]);
    });

    test("selecting a task opens it", () => {
        const onOpenTask = vi.fn();
        const items = buildPaletteItems({
            query: "",
            tasks: [{ id: 1, title: "Refund webhook" }],
            views: [],
            actions: [],
            onOpenTask,
            onGoToView: vi.fn(),
        });
        items[0].run();
        expect(onOpenTask).toHaveBeenCalledWith({ id: 1, title: "Refund webhook" });
    });

    test("selecting a view navigates to it", () => {
        const onGoToView = vi.fn();
        const items = buildPaletteItems({
            query: "plan",
            tasks: [],
            views,
            actions: [],
            onOpenTask: vi.fn(),
            onGoToView,
        });
        items[0].run();
        expect(onGoToView).toHaveBeenCalledWith(
            expect.objectContaining({ view: "sprint", plan: true }),
        );
    });
});

describe("CommandPalette", () => {
    const baseProps = {
        open: true,
        query: "",
        setQuery: vi.fn(),
        items: buildPaletteItems({
            query: "",
            tasks: [{ id: 1, title: "Refund webhook", issue_key: "PAY-142" }],
            views,
            actions,
            onOpenTask: vi.fn(),
            onGoToView: vi.fn(),
        }),
        activeIndex: 0,
        setActiveIndex: vi.fn(),
        onKeyDown: vi.fn(),
        onRun: vi.fn(),
        onClose: vi.fn(),
    };

    test("renders as a dialog with grouped results", () => {
        render(<CommandPalette {...baseProps} />);
        expect(screen.getByRole("dialog", { name: "Command palette" })).toBeTruthy();
        expect(screen.getByText("Tasks")).toBeTruthy();
        expect(screen.getByText("Views")).toBeTruthy();
        expect(screen.getByText("Actions")).toBeTruthy();
    });

    test("the active item is marked for assistive tech", () => {
        render(<CommandPalette {...baseProps} />);
        const options = screen.getAllByRole("option");
        expect(options[0].getAttribute("aria-selected")).toBe("true");
        expect(options[1].getAttribute("aria-selected")).toBe("false");
    });

    test("there is no focus trap", () => {
        render(<CommandPalette {...baseProps} />);
        expect(
            screen.getByRole("dialog").getAttribute("aria-modal"),
        ).toBe("false");
    });

    test("renders nothing when closed", () => {
        const { container } = render(<CommandPalette {...baseProps} open={false} />);
        expect(container.firstChild).toBeNull();
    });

    test("an empty result set says so rather than rendering nothing", () => {
        render(<CommandPalette {...baseProps} items={[]} />);
        expect(screen.getByText("No matches")).toBeTruthy();
    });
});

describe("ShortcutHelp", () => {
    test("lists the complete shortcut set", () => {
        render(<ShortcutHelp open onClose={vi.fn()} />);
        for (const shortcut of TASK_SHORTCUTS) {
            expect(screen.getByText(shortcut.keys)).toBeTruthy();
            expect(screen.getByText(shortcut.action)).toBeTruthy();
        }
    });

    test("documents the palette, help and escape keys", () => {
        const keys = TASK_SHORTCUTS.map((shortcut) => shortcut.keys);
        expect(keys).toContain("Ctrl/Cmd + K");
        expect(keys).toContain("?");
        expect(keys).toContain("Esc");
    });

    test("closes from its own control", () => {
        const onClose = vi.fn();
        render(<ShortcutHelp open onClose={onClose} />);
        fireEvent.click(screen.getByRole("button", { name: "Close shortcut help" }));
        expect(onClose).toHaveBeenCalled();
    });

    test("renders nothing when closed", () => {
        const { container } = render(<ShortcutHelp open={false} onClose={vi.fn()} />);
        expect(container.firstChild).toBeNull();
    });
});
