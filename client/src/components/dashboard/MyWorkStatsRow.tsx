import React from "react";
import type { MyWorkStats } from "./myWork";
import s from "./MyWorkStatsRow.module.css";

const CELLS: { key: keyof Omit<MyWorkStats, "total">; label: string; tone: string }[] = [
    { key: "done", label: "Done", tone: "done" },
    { key: "inProgress", label: "In Progress", tone: "progress" },
    { key: "inReview", label: "In Review", tone: "review" },
    { key: "pending", label: "Pending", tone: "pending" },
];

/**
 * The My Work card's state breakdown: four equal cells and a stacked progress
 * bar. It replaced the separate "Today's Planner" card, which summarised a
 * different ticket set and so disagreed with the list right below it.
 */
export default function MyWorkStatsRow({ stats }: { stats: MyWorkStats }) {
    const share = (value: number) => `${(value / stats.total) * 100}%`;
    return (
        <>
            <div className={s.stats}>
                {CELLS.map((cell) => (
                    <div key={cell.key} className={`${s.cell} ${s[cell.tone]}`}>
                        <span className={s.value}>{stats[cell.key]}</span>
                        <span className={s.label}>{cell.label}</span>
                    </div>
                ))}
            </div>
            <div
                className={s.bar}
                role="progressbar"
                aria-label="My work progress"
                aria-valuemin={0}
                aria-valuemax={stats.total}
                aria-valuenow={stats.done}
            >
                {CELLS.slice(0, 3).map((cell) =>
                    stats[cell.key] > 0 ? (
                        <span
                            key={cell.key}
                            className={`${s.fill} ${s[cell.tone]}`}
                            style={{ width: share(stats[cell.key]) }}
                        />
                    ) : null,
                )}
            </div>
        </>
    );
}
