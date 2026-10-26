import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ChevronLeft } from "../../constants/icons";
import IssueKey from "./IssueKey";
import EpicPanel from "./EpicPanel";
import AsyncSection from "../../components/common/AsyncSection";
import { useCardDensity } from "./TaskContext";
import s from "./SprintPlan.module.css";

interface SprintPlanProps {
    backlogTasks: any[];
    sprintTasks: any[];
    backlogLoading?: boolean;
    backlogError?: string | null;
    onRetryBacklog?: () => void;
    sprintLoading?: boolean;
    sprintError?: string | null;
    onRetrySprint?: () => void;
    sprint: any;
    velocity: { sprints: Array<{ id: number; name: string; velocity_points: number }>; average: number };
    burndown: Array<{ snapshot_date: string; remaining_points: number }>;
    unitLabel: string;
    onMoveToSprint: (taskId: number | string) => void;
    onMoveToBacklog: (taskId: number | string) => void;
    onSaveGoal: (goal: string) => void;
    onOpenDetail: (task: any) => void;
    epics?: any[];
    selectedEpicId?: number | string | null;
    onSelectEpic?: (id: number | string | null) => void;
    scope?: { addedPoints: number; removedPoints: number };
}

function points(tasks: any[]): number {
    return tasks.reduce((sum, task) => sum + (Number(task.story_points) || 0), 0);
}

/**
 * The planning surface: backlog on the left, one sprint on the right.
 *
 * Dragging (or the arrow buttons, which are the keyboard path) pulls work into
 * the sprint or pushes it back out. The goal is editable inline, committed
 * points sit against the sprint's size, and recent velocity plus a mini
 * burndown are visible without leaving the page.
 */
export default function SprintPlan({
    backlogTasks,
    sprintTasks,
    backlogLoading = false,
    backlogError = null,
    onRetryBacklog,
    sprintLoading = false,
    sprintError = null,
    onRetrySprint,
    sprint,
    velocity,
    burndown,
    unitLabel,
    onMoveToSprint,
    onMoveToBacklog,
    onSaveGoal,
    onOpenDetail,
    epics = [],
    selectedEpicId,
    onSelectEpic,
    scope = { addedPoints: 0, removedPoints: 0 },
}: SprintPlanProps) {
    const [goal, setGoal] = useState(sprint?.goal ?? "");
    const [editingGoal, setEditingGoal] = useState(false);
    // Only a real keypress may be persisted: blurring the untouched
    // "Set a goal" placeholder must never write an empty goal over the sprint.
    const [goalDirty, setGoalDirty] = useState(false);
    const editingRef = useRef(false);
    // A sprint goal that changed while the user was typing, adopted once the
    // editor closes.
    const missedSprintGoal = useRef<string | null>(null);

    useEffect(() => {
        editingRef.current = editingGoal;
    }, [editingGoal]);

    // The sprint arrives (or changes) after the plan body already rendered.
    // Adopt its goal — unless the user is mid-edit, in which case remember the
    // incoming goal so it is not lost when they finish.
    useEffect(() => {
        if (editingRef.current) {
            missedSprintGoal.current = sprint?.goal ?? "";
            return;
        }
        setGoal(sprint?.goal ?? "");
        setGoalDirty(false);
    }, [sprint?.id, sprint?.goal]);

    useEffect(() => {
        if (editingGoal || missedSprintGoal.current === null) return;
        const arrived = missedSprintGoal.current;
        missedSprintGoal.current = null;
        setGoal(arrived);
        setGoalDirty(false);
    }, [editingGoal]);

    /** Close the editor. Only a real edit is persisted. */
    const commitGoal = () => {
        const edited = goalDirty;
        setEditingGoal(false);
        setGoalDirty(false);
        // The user's own edit outranks a sprint that arrived meanwhile.
        if (edited) missedSprintGoal.current = null;
        if (edited && goal !== (sprint?.goal ?? "")) onSaveGoal(goal);
    };
    // Compact plan rows drop the points column's neighbours and keep key, title
    // and points — the same rule the backlog and board follow.
    const compact = useCardDensity() === "compact";

    const committed = useMemo(() => points(sprintTasks), [sprintTasks]);
    const capacity = Number(sprint?.velocity_points) || velocity.average || 0;
    const percent = capacity > 0 ? Math.min(100, Math.round((committed / capacity) * 100)) : 0;

    const sparkline = useMemo(() => {
        if (!burndown.length) return null;
        const values = burndown.map((point) => Number(point.remaining_points) || 0);
        const max = Math.max(...values, 1);
        return values
            .map((value, index) => {
                const x = (index / Math.max(1, values.length - 1)) * 100;
                const y = 100 - (value / max) * 100;
                return `${x},${y}`;
            })
            .join(" ");
    }, [burndown]);

    return (
        <div className={s["plan"]}>
            <section className={s["plan-pane"]} aria-label="Backlog">
                <header className={s["plan-pane-header"]}>
                    <h3>Backlog</h3>
                    <span className={s["plan-count"]}>{backlogTasks.length}</span>
                </header>
                <AsyncSection
                    label="backlog"
                    loading={backlogLoading}
                    error={backlogError}
                    hasData={backlogTasks.length > 0}
                    onRetry={onRetryBacklog}
                >
                    <ul className={s["plan-list"]}>
                        {backlogTasks.map((task) => (
                            <li
                                key={task.id}
                                className={`${s["plan-row"]} ${compact ? s["plan-row-compact"] : ""}`}
                            >
                                <IssueKey task={task} copyable={false} />
                                <button
                                    type="button"
                                    className={s["plan-title"]}
                                    onClick={() => onOpenDetail(task)}
                                >
                                    {task.title}
                                </button>
                                <span className={s["plan-points"]}>{task.story_points ?? "–"}</span>
                                {!compact && task.assignee && (
                                    <span className={s["plan-assignee"]}>
                                        {task.assignee.full_name || task.assignee.username}
                                    </span>
                                )}
                                <button
                                    type="button"
                                    className={s["plan-move"]}
                                    aria-label={`Move ${task.title} into the sprint`}
                                    onClick={() => onMoveToSprint(task.id)}
                                >
                                    <ChevronRight size={14} aria-hidden="true" />
                                </button>
                            </li>
                        ))}
                        {backlogTasks.length === 0 && (
                            <li className={s["plan-empty"]}>Nothing left in the backlog.</li>
                        )}
                    </ul>
                </AsyncSection>
            </section>

            <section className={s["plan-pane"]} aria-label="Sprint">
                <header className={s["plan-pane-header"]}>
                    <h3>{sprint?.name ?? "Sprint"}</h3>
                    <span className={s["plan-count"]}>
                        {committed}/{capacity || "–"} {unitLabel}
                    </span>
                </header>

                <div className={s["plan-capacity"]}>
                    <div className={s["plan-capacity-bar"]}>
                        <div
                            className={s["plan-capacity-fill"]}
                            style={{ width: `${percent}%` }}
                        />
                    </div>
                    <span className={s["plan-capacity-text"]}>
                        {committed} committed of {capacity || "unestimated"} {unitLabel}
                        {" · "}
                        <span className={s["plan-scope"]}>
                            +{scope.addedPoints} / −{scope.removedPoints} scope
                        </span>
                    </span>
                </div>

                <div className={s["plan-goal"]}>
                    <span className={s["plan-goal-label"]}>Goal</span>
                    {editingGoal ? (
                        <input
                            className={s["plan-goal-input"]}
                            value={goal}
                            autoFocus
                            aria-label="Sprint goal"
                            onChange={(event) => {
                                setGoal(event.target.value);
                                setGoalDirty(true);
                            }}
                            onBlur={commitGoal}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                                if (event.key === "Escape") {
                                    missedSprintGoal.current = null;
                                    setGoal(sprint?.goal ?? "");
                                    setGoalDirty(false);
                                    setEditingGoal(false);
                                }
                            }}
                        />
                    ) : (
                        <button
                            type="button"
                            className={s["plan-goal-value"]}
                            onClick={() => setEditingGoal(true)}
                        >
                            {goal || "Set a goal"}
                        </button>
                    )}
                </div>

                <AsyncSection
                    label="sprint"
                    loading={sprintLoading}
                    error={sprintError}
                    hasData={sprintTasks.length > 0}
                    onRetry={onRetrySprint}
                >
                    <ul className={s["plan-list"]}>
                        {sprintTasks.map((task) => (
                            <li
                                key={task.id}
                                className={`${s["plan-row"]} ${compact ? s["plan-row-compact"] : ""}`}
                            >
                                <IssueKey task={task} copyable={false} />
                                <button
                                    type="button"
                                    className={s["plan-title"]}
                                    onClick={() => onOpenDetail(task)}
                                >
                                    {task.title}
                                </button>
                                <span className={s["plan-points"]}>{task.story_points ?? "–"}</span>
                                {!compact && task.assignee && (
                                    <span className={s["plan-assignee"]}>
                                        {task.assignee.full_name || task.assignee.username}
                                    </span>
                                )}
                                <button
                                    type="button"
                                    className={s["plan-move"]}
                                    aria-label={`Move ${task.title} back to the backlog`}
                                    onClick={() => onMoveToBacklog(task.id)}
                                >
                                    <ChevronLeft size={14} aria-hidden="true" />
                                </button>
                            </li>
                        ))}
                        {sprintTasks.length === 0 && (
                            <li className={s["plan-empty"]}>Pull work in from the backlog.</li>
                        )}
                    </ul>
                </AsyncSection>

                <div className={s["plan-insights"]}>
                    <div>
                        <span className={s["plan-insights-label"]}>Recent velocity</span>
                        <span className={s["plan-insights-value"]}>
                            {velocity.average || "–"} {unitLabel}
                        </span>
                    </div>
                    {sparkline && (
                        <div
                            className={s["plan-sparkline"]}
                            role="img"
                            aria-label="Mini burndown"
                            style={{
                                "--sparkline": `polygon(${sparkline
                                    .split(" ")
                                    .map((pair) => {
                                        const [x, y] = pair.split(",");
                                        return `${x}% ${y}%`;
                                    })
                                    .join(", ")}, 100% 100%, 0% 100%)`,
                            } as React.CSSProperties}
                        />
                    )}
                </div>

                <EpicPanel
                    epics={epics}
                    selectedEpicId={selectedEpicId}
                    onSelectEpic={onSelectEpic}
                />
            </section>
        </div>
    );
}
