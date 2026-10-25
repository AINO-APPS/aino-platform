import React from "react";
import s from "./EpicPanel.module.css";

export interface EpicRollup {
    id: number | string;
    title: string;
    issue_key?: string | null;
    type_color?: string | null;
    rollup: {
        totalChildren: number;
        doneChildren: number;
        totalPoints: number;
        donePoints: number;
        percentByPoints: number;
        percentByCount: number;
    };
}

interface EpicPanelProps {
    epics: EpicRollup[];
    selectedEpicId?: number | string | null;
    onSelectEpic?: (id: number | string | null) => void;
}

/**
 * The epics panel shown while planning.
 *
 * Each epic reports completed against total in both count and points. An epic
 * with no children renders as an empty bar rather than an error.
 */
export default function EpicPanel({ epics, selectedEpicId, onSelectEpic }: EpicPanelProps) {
    if (epics.length === 0) {
        return (
            <section className={s["epic-panel"]} aria-label="Epics">
                <h3 className={s["epic-title"]}>Epics</h3>
                <p className={s["epic-empty"]}>No epics yet.</p>
            </section>
        );
    }

    return (
        <section className={s["epic-panel"]} aria-label="Epics">
            <h3 className={s["epic-title"]}>Epics</h3>
            <ul className={s["epic-list"]}>
                {epics.map((epic) => {
                    const percent = epic.rollup.percentByPoints || epic.rollup.percentByCount;
                    const selected = selectedEpicId === epic.id;
                    return (
                        <li key={epic.id}>
                            <button
                                type="button"
                                className={`${s["epic-row"]} ${selected ? s["epic-row-selected"] : ""}`}
                                aria-pressed={selected}
                                onClick={() => onSelectEpic?.(selected ? null : epic.id)}
                            >
                                <span
                                    className={s["epic-dot"]}
                                    style={{ background: epic.type_color || "var(--primary)" }}
                                    aria-hidden="true"
                                />
                                <span className={s["epic-name"]}>{epic.title}</span>
                                <span className={s["epic-bar"]} aria-hidden="true">
                                    <span
                                        className={s["epic-bar-fill"]}
                                        style={{ width: `${percent}%` }}
                                    />
                                </span>
                                <span className={s["epic-meta"]}>
                                    {epic.rollup.doneChildren}/{epic.rollup.totalChildren} ·{" "}
                                    {epic.rollup.donePoints}/{epic.rollup.totalPoints} pts
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
