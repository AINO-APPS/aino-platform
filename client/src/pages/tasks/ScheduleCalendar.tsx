import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "../../constants/icons";
import IssueKey from "./IssueKey";
import { useAgileConfig } from "../../AgileConfigContext";
import { currentStatusOption, statusOptions } from "./taskStatus";
import { useIsNarrowCalendar } from "../../hooks/useViewportWidth";
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
import {
    DEFAULT_OVERLAYS,
    overlayItems,
    overlaysForDay,
    toggleOverlay,
    type OverlayItem,
    type OverlayType,
    type OverlayVisibility,
} from "./overlays";
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
    /** Read-only background context: leave, holidays and meetings. */
    overlays?: any;
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
    overlays,
}: ScheduleCalendarProps) {
    const [anchor, setAnchor] = useState(today);
    const [draggingId, setDraggingId] = useState<number | string | null>(null);
    const [overlayVisibility, setOverlayVisibility] = useState<OverlayVisibility>(DEFAULT_OVERLAYS);
    // On a narrow viewport the month grid is unreadable, so the calendar becomes
    // a horizontal date strip plus one scrollable day column.
    const narrow = useIsNarrowCalendar();
    const [selectedDay, setSelectedDay] = useState(today);

    const overlayList = useMemo<OverlayItem[]>(() => overlayItems(overlays), [overlays]);
    const { workflowStates } = (useAgileConfig() as any) ?? {};
    const options = useMemo(() => statusOptions(workflowStates), [workflowStates]);
    const chipStyle = (task: any) =>
        ({ "--chip-color": currentStatusOption(task, workflowStates, options)?.color } as React.CSSProperties);

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
                <div className={s["schedule-modes"]} role="group" aria-label="Overlays">
                    {(["leave", "holidays", "meetings"] as OverlayType[]).map((type) => (
                        <button
                            key={type}
                            type="button"
                            aria-pressed={overlayVisibility[type]}
                            className={overlayVisibility[type] ? s["mode-active"] : ""}
                            onClick={() => setOverlayVisibility((current) => toggleOverlay(current, type))}
                        >
                            {type === "leave" ? "Leave" : type === "holidays" ? "Holidays" : "Meetings"}
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
                {narrow && mode !== "list" ? (
                    <div className={s["day-column"]}>
                        <div
                            className={s["date-strip"]}
                            role="tablist"
                            aria-label="Days"
                        >
                            {weekDays(anchor, today).map((day) => (
                                <button
                                    key={day.date}
                                    type="button"
                                    role="tab"
                                    aria-selected={day.date === selectedDay}
                                    className={`${s["date-strip-day"]} ${day.date === selectedDay ? s["date-strip-active"] : ""} ${day.isToday ? s["date-strip-today"] : ""}`}
                                    onClick={() => setSelectedDay(day.date)}
                                >
                                    <span className={s["date-strip-weekday"]}>
                                        {new Date(`${day.date}T00:00:00`).toLocaleDateString(
                                            undefined,
                                            { weekday: "short" },
                                        )}
                                    </span>
                                    <span className={s["date-strip-number"]}>
                                        {Number(day.date.slice(8, 10))}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <div
                            className={s["day-column-body"]}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => dropOnDay(selectedDay)}
                        >
                            {(byDay.get(selectedDay) ?? []).map((task) => (
                                <button
                                    key={task.id}
                                    type="button"
                                    className={`${s["day-task"]} ${(task as any).completed_at ? s["day-task-done"] : ""}`}
                                    style={chipStyle(task)}
                                    draggable
                                    onDragStart={() => setDraggingId(task.id)}
                                    onClick={() => onOpenDetail(task)}
                                >
                                    <IssueKey task={task as any} copyable={false} />
                                    <span className={s["day-task-title"]}>{task.title}</span>
                                </button>
                            ))}
                            {(byDay.get(selectedDay) ?? []).length === 0 && (
                                <p className={s["day-column-empty"]}>
                                    Nothing planned for this day.
                                </p>
                            )}
                        </div>
                    </div>
                ) : (
                <div
                    className={`${s["grid"]} ${mode === "week" ? s["grid-week"] : ""}`}
                    role="grid"
                    aria-label={mode === "week" ? "Week" : "Month"}
                >
                    {/* A grid needs a row between it and its cells. The row uses
                        `display: contents` so the CSS grid layout is unchanged. */}
                    <div role="row" className={s["grid-row"]}>
                    {days.map((day) => {
                        const dayTasks = byDay.get(day.date) ?? [];
                        const totals = dayTotals(dayTasks);
                        const dayOverlays = overlaysForDay(overlayList, day.date, overlayVisibility);
                        return (
                            <div
                                key={day.date}
                                role="gridcell"
                                aria-label={`${day.date}, ${totals.count} tasks, ${totals.points} points`}
                                className={`${s["day"]} ${day.inMonth ? "" : s["day-outside"]} ${day.isToday ? s["day-today"] : ""}`}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={() => dropOnDay(day.date)}
                            >
                                {dayOverlays.length > 0 && (
                                    <div className={s["day-overlays"]} aria-hidden="true">
                                        {dayOverlays.map((overlay) => (
                                            <span
                                                key={overlay.id}
                                                className={`${s["overlay-band"]} ${s[`overlay-${overlay.type}`]}`}
                                                title={overlay.label}
                                            />
                                        ))}
                                    </div>
                                )}
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
                                            className={`${s["day-task"]} ${(task as any).completed_at ? s["day-task-done"] : ""}`}
                                            style={chipStyle(task)}
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
                </div>
                )}

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
