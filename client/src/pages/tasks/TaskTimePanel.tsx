import { useEffect, useRef, useState } from "react";
import type { LogWorkResponse, TaskWorklog } from "../../api/tasks";
import LogWorkDialog from "./LogWorkDialog";
import DeleteWorklogDialog from "./DeleteWorklogDialog";
import { actionDecision, reasonCopy } from "./ticketCapabilities";
import useRealtimeEvent from "../../hooks/useRealtimeEvent";
import { formatMinutes, summariseTime } from "./time";
import s from "./TaskTimePanel.module.css";
import TaskWorklogList from "./TaskWorklogList";
import WorklogWarnings from './WorklogWarnings';
import InlineEstimate from "./InlineEstimate";

interface TaskTimePanelProps {
    task: any;
    onLogged?: (minutes: number) => void;
}

/** Manual worklogs; the server decides who can log and supplies authoritative totals. */
export default function TaskTimePanel({ task, onLogged }: TaskTimePanelProps) {
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<TaskWorklog | undefined>();
    const [deleting, setDeleting] = useState<TaskWorklog | undefined>();
    const [deleted, setDeleted] = useState<number[]>([]);
    const [logged, setLogged] = useState<number | null>(null);
    const [saved, setSaved] = useState<TaskWorklog[]>([]);
    const [revision, setRevision] = useState(0);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [estimates, setEstimates] = useState<{ original_estimate_minutes: number | null; remaining_estimate_minutes: number | null } | null>(null);
    const effortVersion = useRef(0);
    const publicationVersion = effortVersion.current;
    const publishSavedEffort = (ticket: LogWorkResponse['ticket']) => {
        effortVersion.current++;
        setLogged(ticket.time_spent_minutes);
        setEstimates(ticket);
    };
    const taskId = task?.id;
    const canEditEstimate = actionDecision(task, 'canEditEstimate').allowed;
    useEffect(() => { setEstimates(null); }, [taskId, task?.original_estimate_minutes, task?.remaining_estimate_minutes]);
    const canLogWork = actionDecision(task, 'logWork').allowed;
    const canLogWorkForOthers = actionDecision(task, 'logWorkForOthers').allowed;
    useEffect(() => { setLogged(null); setSaved([]); setOpen(false); setEditing(undefined); setDeleting(undefined); setDeleted([]); setRevision(0); setWarnings([]); }, [taskId]);
    useRealtimeEvent(['task_updated'], event => {
        if (String((event.data as { taskId?: number })?.taskId) !== String(taskId)) return;
        setSaved([]);
        setDeleted([]);
        setEstimates(null);
        setRevision(value => value + 1);
    }, !!taskId);
    const onSaved = (response: LogWorkResponse) => {
        setWarnings(response.warnings);
        publishSavedEffort(response.ticket);
        setSaved(current => [response.worklog, ...current.filter(row => row.id !== response.worklog.id)]);
        setOpen(false);
        setEditing(undefined);
        onLogged?.(response.worklog.minutes);
    };
    const original = estimates ? estimates.original_estimate_minutes : task?.original_estimate_minutes ?? task?.estimated_minutes ?? null;
    const summary = summariseTime({
        estimated_minutes: original,
        logged_minutes: logged ?? task?.time_spent_minutes ?? task?.logged_minutes,
    });

    const remaining = estimates ? estimates.remaining_estimate_minutes : task?.remaining_estimate_minutes ?? null;
    const total = summary.logged + (remaining ?? 0);
    const percent = total > 0 ? Math.round(summary.logged / total * 100) : 0;
    const over = original != null && summary.logged > original;

    return (
        <section className={s["time-panel"]} aria-label="Time tracking">
            <div className={s["time-row"]}>
                <span className={s["time-label"]}>{task.subtask_summary?.total ? "Own time spent" : "Time spent"}</span>
                <span className={s["time-value"]}>
                    {formatMinutes(summary.logged)} /{" "}
                    {original != null ? formatMinutes(original) : "—"}
                </span>
            </div>

            {task.subtask_summary?.total > 0 && task.effort && (
                <div className={s["time-row"]} role="group" aria-label="Including subtasks">
                    <span className={s["time-label"]}>Including subtasks</span>
                    <span className={s["time-value"]}>
                        {formatMinutes(task.effort.total_time_spent_minutes + summary.logged - task.effort.own_time_spent_minutes)} spent
                        {" · "}{task.effort.total_remaining_estimate_minutes == null && remaining == null ? "—"
                            : formatMinutes((task.effort.total_remaining_estimate_minutes ?? 0)
                                + (remaining ?? 0) - (task.effort.own_remaining_estimate_minutes ?? 0))} remaining
                    </span>
                </div>
            )}

            {(['original', 'remaining'] as const).map(kind => <InlineEstimate key={`${taskId}:${kind}`} taskId={taskId} kind={kind}
                value={estimates ? estimates[`${kind}_estimate_minutes`] : (kind === 'original' ? task?.original_estimate_minutes ?? task?.estimated_minutes : task?.remaining_estimate_minutes) ?? null}
                editable={canEditEstimate} onSaved={ticket => { publishSavedEffort(ticket); onLogged?.(0); }} />)}

            {remaining != null && (
                <div className={s["time-bar"]} role="progressbar" aria-label="Time spent and remaining"
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
                    aria-valuetext={`${formatMinutes(summary.logged)} spent, ${formatMinutes(remaining)} remaining`}>
                    <div
                        className={`${s["time-fill"]} ${over ? s["time-over"] : ""}`}
                        style={{ width: `${percent}%` }}
                    />
                </div>
            )}

            <div className={s["time-actions"]}>
                {canLogWork && <button type="button" className={s["time-button"]} onClick={() => setOpen(true)}>Log work</button>}
                {over && <span className={s["time-over-label"]}>Over estimate</span>}
            </div>
            {!canLogWork && <p>{reasonCopy(actionDecision(task, "logWork").reason)}</p>}

            <WorklogWarnings warnings={warnings} />
            {taskId && <TaskWorklogList taskId={taskId} revision={`${revision}:${task?.time_spent_minutes ?? task?.logged_minutes ?? 0}`} saved={saved} deleted={deleted} onEdit={setEditing} onDelete={setDeleting} onSummary={summary => {
                if (publicationVersion !== effortVersion.current) return;
                setLogged(summary.time_spent_minutes);
                if ('original_estimate_minutes' in summary && 'remaining_estimate_minutes' in summary) setEstimates(summary);
            }} />}
            {deleting && <DeleteWorklogDialog taskId={taskId} worklog={deleting} onClose={() => setDeleting(undefined)} onDeleted={ticket => {
                publishSavedEffort(ticket);
                setDeleted(current => [...current, deleting.id]);
                setSaved(current => current.filter(row => row.id !== deleting.id));
                setDeleting(undefined);
                onLogged?.(-deleting.minutes);
            }} />}
            {(editing || (open && canLogWork)) && <LogWorkDialog key={editing?.id ?? 'new'} taskId={taskId} worklog={editing} canLogWorkForOthers={canLogWorkForOthers} onClose={() => { setOpen(false); setEditing(undefined); }} onSaved={onSaved} />}
        </section>
    );
}