import React from "react";
import {
    BarChart3 as StatsIcon,
    AlertTriangle as GlyphAlertTriangle,
    Ban as GlyphBan,
} from "../../constants/icons";
import { SprintLifecycleControls } from "../../components/agile/AgileWorkflowPanels";
import { COLUMNS } from "./constants";
import s from "../Tasks.module.css";

interface SprintProgressCardProps {
    stats: { done: number; total: number; percent: number };
    sprintStats: any;
    features: any;
    unitLabel: string;
    availableSprints: any[];
    selectedSprintId: any;
    currentUser: any;
    getColTasks: (colId: string) => any[];
    onSprintChanged: () => void;
}

/** The sprint header: completion, per-column counts, points and lifecycle. */
export default function SprintProgressCard({
    stats,
    sprintStats,
    features,
    unitLabel,
    availableSprints,
    selectedSprintId,
    currentUser,
    getColTasks,
    onSprintChanged,
}: SprintProgressCardProps) {
    const sprint = availableSprints.find((candidate) => candidate.id === selectedSprintId);
    const canManageSprint = [
        "team_lead",
        "manager",
        "super_admin",
        "hr_admin",
        "platform_admin",
    ].includes(currentUser?.role);

    return (
        <div className={s["tasks-progress-card"]}>
            <div className={s["tasks-progress-info"]}>
                <span className={s["tasks-progress-label"]}>
                    {stats.done}/{stats.total} completed
                </span>
                <span className={s["tasks-progress-pct"]}>{stats.percent}%</span>
            </div>
            <div className={s["tasks-progress-bar"]}>
                <div
                    className={s["tasks-progress-fill"]}
                    style={{ "--fill-width": `${stats.percent}%` } as React.CSSProperties}
                />
            </div>
            <div className={s["tasks-progress-counts"]}>
                {COLUMNS.map((col: any) => (
                    <span key={col.id} style={{ color: col.color }}>
                        {col.icon} {getColTasks(col.id).length} {col.label}
                    </span>
                ))}
            </div>
            {features.storyPoints && sprintStats && sprintStats.totals.points > 0 && (
                <div
                    className={s["tasks-progress-counts"]}
                    style={{ marginTop: 6, fontWeight: 600 }}
                >
                    <span title="Story points: done / total">
                        <StatsIcon size="1em" /> {sprintStats.totals.donePoints} /{" "}
                        {sprintStats.totals.points} {unitLabel} (
                        {sprintStats.totals.percentByPoints}%)
                    </span>
                    {sprintStats.totals.unestimatedTasks > 0 && (
                        <span style={{ color: "var(--warning, #f59e0b)" }}>
                            <GlyphAlertTriangle size="1em" style={{ verticalAlign: "middle" }} />{" "}
                            {sprintStats.totals.unestimatedTasks} unestimated
                        </span>
                    )}
                    {sprintStats.totals.blockedTasks > 0 && (
                        <span style={{ color: "var(--danger, #ef4444)" }}>
                            <GlyphBan size="1em" style={{ verticalAlign: "middle" }} />{" "}
                            {sprintStats.totals.blockedTasks} blocked
                        </span>
                    )}
                </div>
            )}
            {sprint && (
                <div style={{ marginTop: 10 }}>
                    <SprintLifecycleControls
                        sprint={sprint}
                        canEdit={canManageSprint}
                        onChanged={onSprintChanged}
                    />
                </div>
            )}
        </div>
    );
}
