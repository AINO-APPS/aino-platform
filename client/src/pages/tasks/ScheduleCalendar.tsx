import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "../../constants/icons";
import IssueKey from "./IssueKey";
import {
    addDays,
    dayTotals,
    groupByDay,
    monthGrid,
    overdueTasks,
    plannedDay,
    startOfMonth,
    toDateString,
    unscheduledTasks,
    weekDays,
    type CalendarMode,
    type ScheduledTask,
} from "./calendar";
import s from "./ScheduleCalendar.module.css";

interface ScheduleCalendarProps {
    tasks: ScheduledTask[];
    backlogTasks: ScheduledTask[];
    mode: CalendarMode;
    onModeChange: (mode: CalendarMode) => void;
    onPlan: (taskId: number | string, date: string) => void;
    onUnschedule: (taskId: number | string) => void;
    onOpenDetail: (task: any) => void;
    today?: string;
}

/**
 * The Schedule calendar: month grid, week strip, and the unscheduled tray.
 *
 * Dragging a tray item onto a day plans it; dragging a card back to the tray
 * clears it. Each day shows its count and point total so overload is visible,
 * and overdue work is pinned above the grid rather than inside past days.
 */
export default function ScheduleCalendar({
    tasks,
    backlogTasks,
    mode,
    onModeChange,
    onPlan,
    onUnschedule,
    onOpenDetail,
    today = toDateString(new Date()),
}: ScheduleCalendarProps) {
    const [anchor, setAnchor] = useState(today);
    const [draggingId, setDraggingId] = useState<number | string | null>(null);

    const days = useMemo(
        () => (mode === "week" ? weekDays(anchor, today) : monthGrid(anchor, today)),
        [mode, anchor, today],
    );
    const byDay = useMemo(() => groupByDay(tasks), [tasks]);
    const overdue = useMemo(() => overdueTasks(tasks, today), [tasks, today]);
    const tray = useMemo(() => unscheduledTasks(backlogTasks), [backlogTasks]);

    const step = (direction: -1 | 1) => {
        if (mode === "week") setAnchor(addDays(anchor, direction * 7));
        else {
            const date = new Date(anchor);
            date.setMonth(date.getMonth() + direction);
            setAnchor(toDateString(date));
        }
    };

    const dropOnDay = (date: string) => {
        if (draggingId === null) return;
        onPlan(draggingId, date);
        setDraggingId(null);
    };

    return (
        <div className={s["schedule"]}>
            <div className={s["schedule-toolbar"]}>
                <div className={s["schedule-nav"]}>
                    <button type="button" aria-label="Previous" onClick={() => step(-1)}>
                        <ChevronLeft size={16} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => setAnchor(today)}>
                        Today
                    </button>
                    <button type="button" aria-label="Next" onClick={() => step(1)}>
                        <ChevronRight size={16} aria-hidden="true" />
                    </button>
                </div>
                <div className={s["schedule-modes"]} role="group" aria-label="Calendar view">
                    {(["month", "week", "list"] as CalendarMode[]).map((option) => (
                        <button
                            key={option}
                            type="button"
                            aria-pressed={mode === option}
                            className={mode === option ? s["mode-active"] : ""}
                            onClick={() => onModeChange(option)}
                        >
                            {option === "month" ? "Month" : option === "week" ? "Week" : "List"}
                        </button>
                    ))}
                </div>
            </div>

            {overdue.length > 0 && (
                <div className={s["overdue-strip"]} role="status">
                    <strong>Overdue</strong>
                    {overdue.map((task) => (
                        <button
                            key={task.id}
                            type="button"
                            className={s["overdue-chip"]}
                            onClick={() => onOpenDetail(task)}
                        >
                            {task.title}
                        </button>
                    ))}
                </div>
            )}

            <div className={s["schedule-body"]}>
                <div
                    className={`${s["grid"]} ${mode === "week" ? s["grid-week"] : ""}`}
                    role="grid"
                    aria-label={mode === "week" ? "Week" : "Month"}
                >
                    {days.map((day) => {
                        const dayTasks = byDay.get(day.date) ?? [];
                        const totals = dayTotals(dayTasks);
                        return (
                            <div
                                key={day.date}
                                role="gridcell"
                                aria-label={`${day.date}, ${totals.count} tasks, ${totals.points} points`}
                                className={`${s["day"]} ${day.inMonth ? "" : s["day-outside"]} ${day.isToday ? s["day-today"] : ""}`}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={() => dropOnDay(day.date)}
                            >
                                <div className={s["day-header"]}>
                                    <span className={s["day-number"]}>
                                        {Number(day.date.slice(8, 10))}
                                    </span>
                                    {totals.count > 0 && (
                                        <span className={s["day-totals"]}>
                                            {totals.count} · {totals.points} pts
                                        </span>
                                    )}
                                </div>
                                <div className={s["day-tasks"]}>
                                    {dayTasks.map((task) => (
                                        <button
                                            key={task.id}
                                            type="button"
                                            className={s["day-task"]}
                                            draggable
                                            onDragStart={() => setDraggingId(task.id)}
                                            onClick={() => onOpenDetail(task)}
                                        >
                                            <IssueKey task={task as any} copyable={false} />
                                            <span className={s["day-task-title"]}>{task.title}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <aside
                    className={s["tray"]}
                    aria-label="Unscheduled"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                        if (draggingId !== null) onUnschedule(draggingId);
                        setDraggingId(null);
                    }}
                >
                    <h3 className={s["tray-title"]}>Unscheduled</h3>
                    <ul className={s["tray-list"]}>
                        {tray.map((task) => (
                            <li key={task.id}>
                                <button
                                    type="button"
                                    className={s["tray-item"]}
                                    draggable
                                    onDragStart={() => setDraggingId(task.id)}
                                    onClick={() => onOpenDetail(task)}
                                >
                                    <IssueKey task={task as any} copyable={false} />
                                    <span className={s["tray-item-title"]}>{task.title}</span>
                                    <span className={s["tray-points"]}>
                                        {task.story_points ?? "–"}
                                    </span>
                                </button>
                            </li>
                        ))}
                        {tray.length === 0 && (
                            <li className={s["tray-empty"]}>Everything is planned.</li>
                        )}
                    </ul>
                </aside>
            </div>

            {mode === "list" && (
                <div className={s["list-mode"]}>
                    {[...byDay.entries()]
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([date, dayTasks]) => (
                            <section key={date} className={s["list-day"]}>
                                <h4>{date}</h4>
                                <ul>
                                    {dayTasks.map((task) => (
                                        <li key={task.id}>
                                            <button type="button" onClick={() => onOpenDetail(task)}>
                                                {task.title}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        ))}
                </div>
            )}
        </div>
    );
}
