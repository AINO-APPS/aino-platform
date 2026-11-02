import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, AlertCircle, Package, X } from "../../constants/icons";
import { getScheduled, scheduleTask, unscheduleTask, updateTask, updateTaskStatus } from "../../api/tasks";
import { getLocalToday } from "../../api/client";
import useRealtimeEvent from "../../hooks/useRealtimeEvent";
import { useToast } from "../../components/common/Toast";
import TaskCard from "./TaskCard";
import { formatDate, parseLocalDate } from "./utils";
import { groupScheduled, nextDays, scheduledWindow, scheduleDateOf, SCHEDULED_AHEAD_DAYS, SCHEDULED_PAST_DAYS } from "./scheduled";
import { useVisiblePoll } from "./hooks/useVisiblePoll";
import ScheduleCalendar from "./ScheduleCalendar";
import type { CalendarMode } from "./calendar";
import { getBacklog, getScheduleOverlays } from "../../api/tasks";
import s from "./ScheduledTab.module.css";
import { actionDecision, decisionProps, writeError } from "./ticketCapabilities";
import { useTaskDeltas } from "./hooks/useTaskDeltas";

interface ScheduledTabProps {
  updatedTicket?: any;
  filters?: Record<string, string>;
  /** Day (YYYY-MM-DD) to scroll to once loaded, e.g. after "View" on a schedule toast. */
  focusDate?: string | null;
  onFocusConsumed?: () => void;
  onOpenDetail: (task: any) => void;
  onOpenComments: (id: number | string) => void;
  /** Bumped by the page when tasks change elsewhere (detail edits, deletes). */
  version?: number;
  /** Team scope from the admin Plan switcher: `{ team_id }` or `{ unassigned: 1 }`. */
  scopeParams?: Record<string, unknown>;
}

const noopDrag = () => {};
const EMPTY_SCOPE: Record<string, unknown> = {};

/**
 * Scheduled — every unsprinted ticket planned onto a day. Overdue
 * first, then one section per day, then Later; a week strip to jump, and
 * per-card Reschedule / Back to backlog with Undo. Kept in sync by `task_*`
 * realtime events plus a visible-tab poll.
 */
export default function ScheduledTab({ filters, focusDate, onFocusConsumed, onOpenDetail, onOpenComments, version = 0, scopeParams = EMPTY_SCOPE, updatedTicket }: ScheduledTabProps) {
  const toast = useToast() as any;
  const today = getLocalToday();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rescheduleId, setRescheduleId] = useState<number | string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(today);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("month");
  const [backlogTasks, setBacklogTasks] = useState<any[]>([]);
  const [overlays, setOverlays] = useState<any>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const load = useCallback(async () => {
    try {
      const res = await getScheduled({ ...(filters || {}), ...scopeParams } as any);
      setTasks((((res.data as any)?.tasks as any[]) || []).filter((task) => task.container === "scheduled"));
      setError("");
    } catch {
      setError("Failed to load scheduled tasks");
    } finally {
      setLoading(false);
    }
  }, [filters, scopeParams]);

  useEffect(() => { load(); }, [load, version]);
  useTaskDeltas(setTasks, { container: "scheduled", onRefresh: () => { void load(); void loadBacklog(); } });
  useRealtimeEvent(["task_assigned"], () => { void load(); void loadBacklog(); });
  useVisiblePoll(load);

  // The unscheduled tray is backlog work with no planned day.
  const loadBacklog = useCallback(async () => {
    try {
      const res = await getBacklog({ ...scopeParams, limit: 200 });
      setBacklogTasks((((res.data as any)?.tasks as any[]) || []).filter((task) => task.container === "backlog"));
    } catch {
      // The tray is supplementary; a failure must not block the calendar.
    }
  }, [scopeParams]);
  useEffect(() => { void loadBacklog(); }, [loadBacklog, version]);
  const replaceTicket = (fresh: any) => {
    setTasks((current) => current.map((task) => task.id === fresh.id ? fresh : task).filter((task) => task.container === "scheduled"));
    setBacklogTasks((current) => current.map((task) => task.id === fresh.id ? fresh : task).filter((task) => task.container === "backlog"));
  };
  useEffect(() => { if (updatedTicket) replaceTicket(updatedTicket); }, [updatedTicket]);

  // Read-only context behind the calendar: leave, holidays and meetings.
  useEffect(() => {
    const [start, end] = scheduledWindow(getLocalToday());
    getScheduleOverlays(start, end)
      .then((res) => setOverlays(res.data))
      .catch(() => setOverlays(null));
  }, [version]);

  const groups = useMemo(() => groupScheduled(tasks, today), [tasks, today]);
  // `date === null` covers both Overdue and Later buckets; only Overdue counts.
  const overdueCount = groups.find((g) => g.key === "overdue")?.tasks.length ?? 0;
  const countByDay = useMemo(() => {
    const m: Record<string, number> = {};
    tasks.forEach((t) => { const d = scheduleDateOf(t); if (d) m[d] = (m[d] || 0) + 1; });
    return m;
  }, [tasks]);

  const jumpTo = useCallback((day: string) => {
    const target = groups.find((g) => g.date !== null && g.date >= day);
    const el = target && sectionRefs.current[target.key];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [groups]);

  useEffect(() => {
    if (!focusDate || loading || !groups.length) return;
    jumpTo(focusDate);
    onFocusConsumed?.();
  }, [focusDate, loading, groups, jumpTo, onFocusConsumed]);

  const doReschedule = async (task: any, date: string) => {
    const previous = task.planned_date?.slice(0, 10);
    if (task.due_date && date > task.due_date.slice(0, 10)) {
      toast.error("The planned day cannot be after the due date");
      return;
    }
    try {
      const { data } = await scheduleTask(task.id, date);
      replaceTicket(data);
      setRescheduleId(null);
      await load();
      toast.success(
        <span>
          Rescheduled to {formatDate(date)}
          {previous && previous !== date && (
            <button className={s["toast-action"]} onClick={() => doReschedule(task, previous)}>Undo</button>
          )}
        </span>,
        6000,
      );
    } catch (error) {
      toast.error(writeError(error, "Failed to reschedule task"));
    }
  };

  const doUnschedule = async (task: any) => {
    const previousPlanned = task.planned_date?.slice(0, 10) || null;
    const previousDue = task.due_date?.slice(0, 10) || null;
    try {
      const { data } = await unscheduleTask(task.id);
      replaceTicket(data);
      void loadBacklog();
      const undo = async () => {
        try {
          if (previousDue) replaceTicket((await updateTask(task.id, { due_date: previousDue })).data);
          if (previousPlanned) replaceTicket((await scheduleTask(task.id, previousPlanned)).data);
          await load(); await loadBacklog();
        } catch (error) { toast.error(writeError(error, "Failed to undo placement")); }
      };
      toast.success(
        <span>
          Moved to backlog
          <button className={s["toast-action"]} onClick={undo}>Undo</button>
        </span>,
        6000,
      );
    } catch (error) {
      toast.error(writeError(error, "Failed to move task to backlog"));
    }
  };

  return (
    <div className={s.scheduled}>
      <ScheduleCalendar
        tasks={tasks}
        backlogTasks={backlogTasks}
        mode={calendarMode}
        onModeChange={setCalendarMode}
        onPlan={async (taskId, date) => {
          const task = [...tasks, ...backlogTasks].find((item) => String(item.id) === String(taskId));
          if (!actionDecision(task, "schedule").allowed) return;
          try {
            const { data } = await scheduleTask(taskId, date);
            replaceTicket(data);
            await load(); await loadBacklog();
          } catch (error) { toast.error(writeError(error, "Failed to schedule task")); }
        }}
        onUnschedule={async (taskId) => {
          const task = tasks.find((item) => String(item.id) === String(taskId));
          if (!actionDecision(task, "schedule").allowed) return;
          await doUnschedule(task);
        }}
        onOpenDetail={onOpenDetail}
        today={today}
        overlays={overlays}
      />
      {calendarMode === "list" && (
      <>
      <div className={s.toolbar}>
        <div className={s.week} role="list" aria-label="Jump to a day">
          {nextDays(today, 7).map((day) => {
            const d = parseLocalDate(day);
            return (
              <button
                key={day}
                role="listitem"
                className={`${s.day} ${day === today ? s["day-today"] : ""}`}
                onClick={() => jumpTo(day)}
                title={`Jump to ${d.toDateString()}`}
              >
                <span className={s["day-name"]}>{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
                <span className={s["day-num"]}>{d.getDate()}</span>
                <span className={`${s["day-dot"]} ${countByDay[day] ? s["day-dot-on"] : ""}`} />
              </button>
            );
          })}
        </div>
        <label className={s.jump} title="Jump to any day">
          <CalendarDays size={15} />
          <input type="date" onChange={(e) => e.target.value && jumpTo(e.target.value)} />
        </label>
        {overdueCount > 0 && (
          <span className={s["overdue-pill"]}><AlertCircle size={13} /> {overdueCount} overdue</span>
        )}
      </div>

      {error && <div className="error-msg error-msg-mb">{error}</div>}

      {loading && !tasks.length ? (
        <div className="loading-spinner"><div className="spinner" /></div>
      ) : groups.length === 0 ? (
        <div className={s.empty}>
          <CalendarDays size={36} strokeWidth={1.5} />
          <p>Nothing scheduled</p>
          <span>Schedule a backlog ticket onto a day and it moves here.</span>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.key} ref={(el) => { sectionRefs.current[g.key] = el; }} className={s.section}>
            <div className={`${s["section-header"]} ${g.key === "overdue" ? s["section-overdue"] : g.date === today ? s["section-today"] : ""}`}>
              {g.key === "overdue" ? <AlertCircle size={14} /> : <span className={s["section-dot"]} />}
              <span>{g.label}</span>
              <span className={s["section-count"]}>{g.tasks.length}</span>
            </div>
            <div className={s.grid}>
              {g.tasks.map((task) => (
                <div key={task.id} className={s.item}>
                  <TaskCard
                    onStatusChange={async (task, target) => {
                      try {
                        const { data } = await updateTaskStatus(task.id, target.id);
                        replaceTicket(data);
                      } catch (error) { toast.error(writeError(error, "Failed to update status")); }
                    }}
                    task={task}
                    onOpenDetail={onOpenDetail}
                    onOpenComments={onOpenComments}
                    onDragStart={noopDrag}
                    onDragEnd={noopDrag}
                  />
                  <div className={s.actions}>
                    {g.key !== "overdue" && g.key !== "later" && !task.planned_date && (
                      <span className={s["was-date"]}>
                        {task.planned_date ? `Planned ${formatDate(task.planned_date)}` : `Due ${formatDate(task.due_date)}`}
                      </span>
                    )}
                    {rescheduleId === task.id ? (
                      <span className={s.popover}>
                        <input type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} />
                        <button className="btn btn-primary btn-sm" onClick={() => doReschedule(task, rescheduleDate)}>Go</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setRescheduleId(null)} aria-label="Cancel"><X size={14} /></button>
                      </span>
                    ) : (
                      <>
                        <button {...decisionProps(actionDecision(task, "schedule"))} className={s.action} onClick={() => { setRescheduleId(task.id); setRescheduleDate(task.planned_date?.slice(0, 10) || today); }}>
                          <CalendarDays size={13} /> Reschedule
                        </button>
                        <button {...decisionProps(actionDecision(task, "schedule"))} className={s.action} onClick={() => doUnschedule(task)}>
                          <Package size={13} /> Back to backlog
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
      {groups.length > 0 && (
        <p className={s.footnote}>
          Overdue first, then the next {SCHEDULED_AHEAD_DAYS} days day by day; anything further out is under Later.
          Completed tickets older than {SCHEDULED_PAST_DAYS} days are hidden.
        </p>
      )}
      </>
      )}
    </div>
  );
}
