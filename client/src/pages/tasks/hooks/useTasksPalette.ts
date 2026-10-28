import { useEffect, useState } from "react";
import { useCommandPalette, type PaletteAction } from "./useCommandPalette";
import { planningTabs } from "./usePlanningSurface";

interface UseTasksPaletteOptions {
    sprintId: string | number | null;
    /** Agile off means no Sprint board is ever offered. */
    agileEnabled: boolean;
    /** The team's sprints: a started one switches the palette to the board. */
    sprints: any[];
    onOpenTask: (task: any) => void;
    onGoToView: (view: string, sprintId?: string | number | null) => void;
    onNewTask: () => void;
    onToggleCompleted: () => void;
    onToggleDensity: () => void;
}

/**
 * The Tasks page's palette wiring.
 *
 * Keeps the action list and the `?` help overlay out of the page component so
 * `Tasks.tsx` stays within its file-size ratchet.
 */
export function useTasksPalette({
    sprintId,
    agileEnabled,
    sprints,
    onOpenTask,
    onGoToView,
    onNewTask,
    onToggleCompleted,
    onToggleDensity,
}: UseTasksPaletteOptions) {
    const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);

    const actions: PaletteAction[] = [
        { id: "action-new-task", label: "New task", run: onNewTask },
        {
            id: "action-toggle-completed",
            label: "Toggle completed",
            run: onToggleCompleted,
        },
        { id: "action-set-density", label: "Set density", run: onToggleDensity },
        {
            id: "action-start-sprint",
            label: "Start sprint",
            run: () => onGoToView("sprint", sprintId),
        },
        {
            id: "action-shortcuts",
            label: "Keyboard shortcuts",
            run: () => setShortcutHelpOpen(true),
        },
    ];

    // Sprint and Scheduled are alternatives, so the palette offers only the tabs
    // this team has — the same rule the tab row uses.
    const allowedViews = planningTabs({ agileEnabled, sprints }).tabs;

    const palette = useCommandPalette({
        sprintId: sprintId == null ? null : String(sprintId),
        allowedViews,
        actions,
        onOpenTask,
        onGoToView: (view) => onGoToView(view.view, view.sprintId),
    });

    // `?` opens the shortcut help overlay, unless the user is typing.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "?") return;
            const target = event.target as HTMLElement | null;
            const tag = target?.tagName?.toLowerCase();
            if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
                return;
            }
            event.preventDefault();
            setShortcutHelpOpen((open) => !open);
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, []);

    return {
        palette,
        shortcutHelpOpen,
        closeShortcutHelp: () => setShortcutHelpOpen(false),
    };
}
