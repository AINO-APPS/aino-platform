import React, { useCallback, useEffect, useState } from "react";
import { Play, Square } from "../../constants/icons";
import { getTaskTimer, startTaskTimer, stopTaskTimer } from "../../api/tasks";
import { formatMinutes, summariseTime } from "./time";
import s from "./TaskTimePanel.module.css";

interface TaskTimePanelProps {
    task: any;
    /** Called after a timer stops so the parent can refresh logged minutes. */
    onLogged?: (minutes: number) => void;
}

/**
 * Logged time against estimate, with the timer startable from the task.
 *
 * The elapsed time is attributed to this task and rolls into the timesheet.
 */
export default function TaskTimePanel({ task, onLogged }: TaskTimePanelProps) {
    const [running, setRunning] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [logged, setLogged] = useState<number | null>(null);

    const taskId = task?.id;

    useEffect(() => {
        setLogged(null);
        setError("");
        if (!taskId) {
            setRunning(false);
            return;
        }
        let cancelled = false;
        getTaskTimer(taskId)
            .then((res) => {
                if (!cancelled) setRunning(!!(res.data as any)?.running);
            })
            .catch(() => {
                if (!cancelled) setRunning(false);
            });
        return () => {
            cancelled = true;
        };
    }, [taskId]);

    const start = useCallback(async () => {
        if (!taskId) return;
        setBusy(true);
        setError("");
        try {
            await startTaskTimer(taskId);
            setRunning(true);
        } catch {
            setError("Could not start the timer");
        } finally {
            setBusy(false);
        }
    }, [taskId]);

    const stop = useCallback(async () => {
        if (!taskId) return;
        setBusy(true);
        setError("");
        try {
            const res = await stopTaskTimer(taskId);
            const minutes = Number((res.data as any)?.minutes) || 0;
            setRunning(false);
            setLogged(((task?.logged_minutes as number) || 0) + minutes);
            onLogged?.(minutes);
        } catch {
            setError("Could not stop the timer");
        } finally {
            setBusy(false);
        }
    }, [taskId, task?.logged_minutes, onLogged]);

    const summary = summariseTime({
        estimated_minutes: task?.estimated_minutes,
        logged_minutes: logged ?? task?.logged_minutes,
    });

    return (
        <section className={s["time-panel"]} aria-label="Time tracking">
            <div className={s["time-row"]}>
                <span className={s["time-label"]}>Logged</span>
                <span className={s["time-value"]}>
                    {formatMinutes(summary.logged)} /{" "}
                    {summary.estimated ? formatMinutes(summary.estimated) : "—"}
                </span>
            </div>

            {summary.estimated > 0 && (
                <div className={s["time-bar"]} aria-hidden="true">
                    <div
                        className={`${s["time-fill"]} ${summary.over ? s["time-over"] : ""}`}
                        style={{ width: `${Math.min(100, summary.percent)}%` }}
                    />
                </div>
            )}

            <div className={s["time-actions"]}>
                {running ? (
                    <button
                        type="button"
                        className={s["time-button"]}
                        onClick={stop}
                        disabled={busy}
                    >
                        <Square size={13} aria-hidden="true" /> Stop timer
                    </button>
                ) : (
                    <button
                        type="button"
                        className={s["time-button"]}
                        onClick={start}
                        disabled={busy}
                    >
                        <Play size={13} aria-hidden="true" /> Start timer
                    </button>
                )}
                {summary.over && <span className={s["time-over-label"]}>Over estimate</span>}
            </div>

            {error && (
                <p className={s["time-error"]} role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}
