import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, AlertCircle, Package, X } from "lucide-react";
import { getTasks, scheduleTask, unscheduleTask } from "../../api/tasks";
import { getLocalToday } from "../../api/client";
import useRealtimeEvent from "../../hooks/useRealtimeEvent";
import { useToast } from "../../components/common/Toast";
import TaskCard from "./TaskCard";
import { formatDate, parseLocalDate } from "./utils";
import { groupScheduled, nextDays, scheduledWindow, SCHEDULED_AHEAD_DAYS, SCHEDULED_PAST_DAYS } from "./scheduled";
import { useVisiblePoll } from "./hooks/useVisiblePoll";
import s from "./ScheduledTab.module.css";

interface ScheduledTabProps {
  filters?: Record<string, string>;
  /** Day (YYYY-MM-DD) to scroll to once loaded, e.g. after "View" on a schedule toast. */
  focusDate?: string | null;
  onFocusConsumed?: () => void;
  onOpenDetail: (task: any) => void;
  onOpenComments: (id: number | string) => void;
  /** Bumped by the page when tasks change elsewhere (detail edits, deletes). */
  version?: number;
}

const noopDrag = () => {};

/**
 * Scheduled — tasks planned onto a day (Backlog → Schedule, carry-forward,
 * the mobile app). Overdue first, then one section per day from today, a
 * week strip to jump, and per-card Reschedule / Back to backlog with Undo.
 * Kept in sync by `task_*` realtime events plus a visible-tab poll.
 */
export default function ScheduledTab({ filters, focusDate, onFocusConsumed, onOpenDetail, onOpenComments, version = 0 }: ScheduledTabProps) {
  const toast = useToast() as any;
  const today = getLocalToday();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rescheduleId, setRescheduleId] = useState<number | string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(today);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const load = useCallback(async () => {
    const [start, end] = scheduledWindow(getLocalToday());
    try {
      const res = await getTasks(undefined, { ...(filters || {}), start_date: start, end_date: end } as any);
      setTasks(((res.data as any)?.tasks as any[]) || []);
      setError("");
    } catch {
      setError("Failed to load scheduled tasks");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load, version]);
  useRealtimeEvent(["task_updated", "task_assigned"], () => { load(); });
  useVisiblePoll(load);

  const groups = useMemo(() => groupScheduled(tasks, today), [tasks, today]);
  const overdueCount = groups.find((g) => g.date === null)?.tasks.length ?? 0;
  const countByDay = useMemo(() => {
    const m: Record<string, number> = {};
    tasks.forEach((t) => { const d = t.date?.slice(0, 10); if (d) m[d] = (m[d] || 0) + 1; });
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
    const previous = task.date?.slice(0, 10);
    try {
      await scheduleTask(task.id, date);
      setRescheduleId(null);
      await load();
      toast.success(
        <span>
          Rescheduled to {formatDate(date)}
          {previous && previous !== date && (
            <button className={s["toast-action"]} onClick={() => scheduleTask(task.id, previous).then(load)}>Undo</button>
          )}
        </span>,
        6000,
      );
    } catch {
      toast.error("Failed to reschedule task");
    }
  };

  const doUnschedule = async (task: any) => {
    const previous = task.date?.slice(0, 10);
    try {
      await unscheduleTask(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      toast.success(
        <span>
          Moved to backlog
          {previous && (
            <button className={s["toast-action"]} onClick={() => scheduleTask(task.id, previous).then(load)}>Undo</button>
          )}
        </span>,
        6000,
      );
    } catch {
      toast.error("Failed to move task to backlog");
    }
  };

  return (
    <div className={s.scheduled}>
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
          <span>Schedule tickets from the Backlog to plan them onto a day.</span>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.key} ref={(el) => { sectionRefs.current[g.key] = el; }} className={s.section}>
            <div className={`${s["section-header"]} ${g.date === null ? s["section-overdue"] : g.date === today ? s["section-today"] : ""}`}>
              {g.date === null ? <AlertCircle size={14} /> : <span className={s["section-dot"]} />}
              <span>{g.label}</span>
              <span className={s["section-count"]}>{g.tasks.length}</span>
            </div>
            <div className={s.grid}>
              {g.tasks.map((task) => (
                <div key={task.id} className={s.item}>
                  <TaskCard
                    task={task}
                    onOpenDetail={onOpenDetail}
                    onOpenComments={onOpenComments}
                    onDragStart={noopDrag}
                    onDragEnd={noopDrag}
                  />
                  <div className={s.actions}>
                    {g.date === null && <span className={s["was-date"]}>Planned {formatDate(task.date)}</span>}
                    {rescheduleId === task.id ? (
                      <span className={s.popover}>
                        <input type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} />
                        <button className="btn btn-primary btn-sm" onClick={() => doReschedule(task, rescheduleDate)}>Go</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setRescheduleId(null)} aria-label="Cancel"><X size={14} /></button>
                      </span>
                    ) : (
                      <>
                        <button className={s.action} onClick={() => { setRescheduleId(task.id); setRescheduleDate(task.date?.slice(0, 10) || today); }}>
                          <CalendarDays size={13} /> Reschedule
                        </button>
                        <button className={s.action} onClick={() => doUnschedule(task)}>
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
          Showing the past {SCHEDULED_PAST_DAYS} days (overdue) and the next {SCHEDULED_AHEAD_DAYS} days.
        </p>
      )}
    </div>
  );
}
