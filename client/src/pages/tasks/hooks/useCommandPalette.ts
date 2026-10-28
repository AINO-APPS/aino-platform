import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { searchTasks } from "../../../api/tasks";
import type { TasksView } from "./useTasksRoute";

export interface PaletteTask {
    id: number | string;
    title: string;
    issue_key?: string | null;
}

export interface PaletteView {
    id: string;
    label: string;
    view: TasksView;
    sprintId?: string | null;
    plan?: boolean;
}

export interface PaletteAction {
    id: string;
    label: string;
    run: () => void;
}

export type PaletteGroup = "tasks" | "views" | "actions";

export interface PaletteItem {
    id: string;
    group: PaletteGroup;
    label: string;
    hint?: string;
    run: () => void;
}

/**
 * The views the palette offers, in the order they appear.
 *
 * `allowed` is the team's tab set (`planningTabs`). Sprint and Scheduled are
 * alternatives, so the palette must not offer the one this team does not have —
 * otherwise the hidden tab stays reachable from the keyboard.
 */
export function paletteViews(sprintId?: string | null, allowed?: string[]): PaletteView[] {
    const views: PaletteView[] = [
        { id: "view-backlog", label: "Backlog", view: "backlog" },
        { id: "view-board", label: "Sprint board", view: "sprint", sprintId },
        { id: "view-plan", label: "Sprint plan", view: "sprint", sprintId, plan: true },
        { id: "view-schedule", label: "Schedule", view: "scheduled" },
        { id: "view-desk", label: "Service desk", view: "service-desk" },
    ];
    if (!allowed) return views;
    return views.filter((entry) => allowed.includes(entry.view));
}

/**
 * Flatten the three groups into one keyboard-navigable list.
 *
 * Tasks come first because that is what people search for; views and actions
 * follow. An empty query still lists views and actions so the palette is useful
 * as a launcher, not only as a search box.
 */
export function buildPaletteItems(input: {
    query: string;
    tasks: PaletteTask[];
    views: PaletteView[];
    actions: PaletteAction[];
    onOpenTask: (task: PaletteTask) => void;
    onGoToView: (view: PaletteView) => void;
}): PaletteItem[] {
    const { query, tasks, views, actions, onOpenTask, onGoToView } = input;
    const needle = query.trim().toLowerCase();
    const matches = (text: string) => !needle || text.toLowerCase().includes(needle);

    const taskItems: PaletteItem[] = tasks
        .filter((task) => matches(task.title) || matches(task.issue_key || ""))
        .map((task) => ({
            id: `task-${task.id}`,
            group: "tasks" as const,
            label: task.title,
            hint: task.issue_key || `#${task.id}`,
            run: () => onOpenTask(task),
        }));

    const viewItems: PaletteItem[] = views
        .filter((view) => matches(view.label))
        .map((view) => ({
            id: view.id,
            group: "views" as const,
            label: view.label,
            run: () => onGoToView(view),
        }));

    const actionItems: PaletteItem[] = actions
        .filter((action) => matches(action.label))
        .map((action) => ({
            id: action.id,
            group: "actions" as const,
            label: action.label,
            run: action.run,
        }));

    return [...taskItems, ...viewItems, ...actionItems];
}

/**
 * The command palette.
 *
 * One keyboard entry point: `Ctrl/Cmd+K` opens it, arrow keys move, `Enter`
 * runs, `Escape` closes. There is no focus trap — Tab leaves the palette for
 * the page behind it — and every item is reachable by keyboard alone.
 */
export function useCommandPalette(options: {
    sprintId?: string | null;
    /** The team's tab set, so a hidden surface is not offered here either. */
    allowedViews?: string[];
    actions: PaletteAction[];
    onOpenTask: (task: PaletteTask) => void;
    onGoToView: (view: PaletteView) => void;
}) {
    const { sprintId, allowedViews, actions, onOpenTask, onGoToView } = options;
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [tasks, setTasks] = useState<PaletteTask[]>([]);
    const [activeIndex, setActiveIndex] = useState(0);
    const previouslyFocused = useRef<HTMLElement | null>(null);

    const views = useMemo(() => paletteViews(sprintId, allowedViews), [sprintId, allowedViews]);

    const items = useMemo(
        () =>
            buildPaletteItems({
                query,
                tasks,
                views,
                actions,
                onOpenTask,
                onGoToView,
            }),
        [query, tasks, views, actions, onOpenTask, onGoToView],
    );

    const close = useCallback(() => {
        setOpen(false);
        setQuery("");
        setActiveIndex(0);
        previouslyFocused.current?.focus?.();
    }, []);

    const openPalette = useCallback(() => {
        previouslyFocused.current = document.activeElement as HTMLElement | null;
        setOpen(true);
        setQuery("");
        setActiveIndex(0);
    }, []);

    // Ctrl/Cmd+K opens; Escape closes. Both are document-level so the palette
    // works from anywhere on the page.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                setOpen((current) => {
                    if (current) {
                        setQuery("");
                        setActiveIndex(0);
                        return false;
                    }
                    previouslyFocused.current = document.activeElement as HTMLElement | null;
                    return true;
                });
                return;
            }
            if (event.key === "Escape" && open) {
                event.stopPropagation();
                close();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [open, close]);

    // Debounced task search. A key like PROJ-123 resolves through the same
    // endpoint, which ranks an exact key match first.
    useEffect(() => {
        if (!open) return;
        const trimmed = query.trim();
        if (trimmed.length < 2) {
            setTasks([]);
            return;
        }
        let cancelled = false;
        const handle = setTimeout(() => {
            searchTasks(trimmed)
                .then((res) => {
                    if (cancelled) return;
                    const data = res.data as PaletteTask[];
                    setTasks(Array.isArray(data) ? data : []);
                })
                .catch(() => {
                    if (!cancelled) setTasks([]);
                });
        }, 150);
        return () => {
            cancelled = true;
            clearTimeout(handle);
        };
    }, [open, query]);

    const runActive = useCallback(() => {
        const item = items[activeIndex];
        if (!item) return;
        item.run();
        close();
    }, [items, activeIndex, close]);

    const onInputKeyDown = useCallback(
        (event: React.KeyboardEvent) => {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => (items.length ? (index + 1) % items.length : 0));
            } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) =>
                    items.length ? (index - 1 + items.length) % items.length : 0,
                );
            } else if (event.key === "Enter") {
                event.preventDefault();
                runActive();
            }
        },
        [items.length, runActive],
    );

    return {
        open,
        openPalette,
        close,
        query,
        setQuery,
        items,
        activeIndex,
        setActiveIndex,
        onInputKeyDown,
        runActive,
    };
}
