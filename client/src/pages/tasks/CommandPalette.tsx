import React from "react";
import { Search } from "../../constants/icons";
import type { PaletteItem } from "./hooks/useCommandPalette";
import s from "./CommandPalette.module.css";

interface CommandPaletteProps {
    open: boolean;
    query: string;
    setQuery: (value: string) => void;
    items: PaletteItem[];
    activeIndex: number;
    setActiveIndex: (index: number) => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
    onRun: () => void;
    onClose: () => void;
}

const GROUP_LABELS: Record<PaletteItem["group"], string> = {
    tasks: "Tasks",
    views: "Views",
    actions: "Actions",
};

/**
 * One keyboard entry point for tasks, views and actions.
 *
 * `Ctrl/Cmd+K` opens it, arrow keys move, `Enter` runs, `Escape` closes. There
 * is no focus trap: Tab leaves the palette for the page behind it.
 */
export default function CommandPalette({
    open,
    query,
    setQuery,
    items,
    activeIndex,
    setActiveIndex,
    onKeyDown,
    onRun,
    onClose,
}: CommandPaletteProps) {
    if (!open) return null;

    let lastGroup: PaletteItem["group"] | null = null;

    return (
        <div className={s["backdrop"]} role="presentation" onClick={onClose}>
            <div
                className={s["palette"]}
                role="dialog"
                aria-modal="false"
                aria-label="Command palette"
                onClick={(event) => event.stopPropagation()}
            >
                <div className={s["search-row"]}>
                    <Search size={15} aria-hidden="true" />
                    <input
                        className={s["input"]}
                        value={query}
                        autoFocus
                        aria-label="Search tasks, views and actions"
                        aria-controls="command-palette-results"
                        aria-activedescendant={
                            items[activeIndex] ? `palette-item-${items[activeIndex].id}` : undefined
                        }
                        placeholder="Search tasks by key or title, or jump to a view…"
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={onKeyDown}
                    />
                    <kbd className={s["esc-hint"]}>Esc</kbd>
                </div>

                <ul
                    id="command-palette-results"
                    className={s["results"]}
                    role="listbox"
                    aria-label="Results"
                >
                    {items.length === 0 && (
                        <li className={s["empty"]} role="presentation">
                            No matches
                        </li>
                    )}
                    {items.map((item, index) => {
                        const showGroup = item.group !== lastGroup;
                        lastGroup = item.group;
                        return (
                            <React.Fragment key={item.id}>
                                {showGroup && (
                                    <li className={s["group"]} role="presentation">
                                        {GROUP_LABELS[item.group]}
                                    </li>
                                )}
                                <li
                                    id={`palette-item-${item.id}`}
                                    role="option"
                                    aria-selected={index === activeIndex}
                                    className={`${s["item"]} ${index === activeIndex ? s["active"] : ""}`}
                                    onMouseEnter={() => setActiveIndex(index)}
                                    onClick={onRun}
                                >
                                    <span className={s["item-label"]}>{item.label}</span>
                                    {item.hint && (
                                        <span className={s["item-hint"]}>{item.hint}</span>
                                    )}
                                </li>
                            </React.Fragment>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}
