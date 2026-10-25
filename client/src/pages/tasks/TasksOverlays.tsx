import React from "react";
import CommandPalette from "./CommandPalette";
import ShortcutHelp from "./ShortcutHelp";
import type { useTasksPalette } from "./hooks/useTasksPalette";

interface TasksOverlaysProps {
    palette: ReturnType<typeof useTasksPalette>["palette"];
    shortcutHelpOpen: boolean;
    onCloseShortcutHelp: () => void;
}

/**
 * The Tasks page's keyboard surfaces: the command palette and the `?` help
 * overlay. Extracted so `Tasks.tsx` stays within its file-size ratchet.
 */
export default function TasksOverlays({
    palette,
    shortcutHelpOpen,
    onCloseShortcutHelp,
}: TasksOverlaysProps) {
    return (
        <>
            <CommandPalette
                open={palette.open}
                query={palette.query}
                setQuery={palette.setQuery}
                items={palette.items}
                activeIndex={palette.activeIndex}
                setActiveIndex={palette.setActiveIndex}
                onKeyDown={palette.onInputKeyDown}
                onRun={palette.runActive}
                onClose={palette.close}
            />
            <ShortcutHelp open={shortcutHelpOpen} onClose={onCloseShortcutHelp} />
        </>
    );
}
