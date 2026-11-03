import { useEffect, useState } from "react";
import type { LogWorkResponse, TaskWorklog } from "../../api/tasks";
import LogWorkDialog from "./LogWorkDialog";
import DeleteWorklogDialog from "./DeleteWorklogDialog";
import { actionDecision } from "./ticketCapabilities";
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
    const taskId = task?.id;
    const canEditEstimate = actionDecision(task, 'canEditEstimate').allowed;
    useEffect(() => { setEstimates(null); }, [taskId, task?.original_estimate_minutes, task?.remaining_estimate_minutes]);
    const canLogWork = actionDecision(task, 'logWork').allowed;
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
        setLogged(response.ticket.time_spent_minutes);
        setEstimates(response.ticket);
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

    const over = original != null && summary.logged > original;

    return (
        <section className={s["time-panel"]} aria-label="Time tracking">
            <div className={s["time-row"]}>
                <span className={s["time-label"]}>Time spent</span>
                <span className={s["time-value"]}>
                    {formatMinutes(summary.logged)} /{" "}
                    {original != null ? formatMinutes(original) : "—"}
                </span>
            </div>

            {(['original', 'remaining'] as const).map(kind => <InlineEstimate key={`${taskId}:${kind}`} taskId={taskId} kind={kind}
                value={estimates ? estimates[`${kind}_estimate_minutes`] : (kind === 'original' ? task?.original_estimate_minutes ?? task?.estimated_minutes : task?.remaining_estimate_minutes) ?? null}
                editable={canEditEstimate} onSaved={ticket => { setEstimates(ticket); onLogged?.(0); }} />)}

            {original != null && (
                <div className={s["time-bar"]} aria-hidden="true">
                    <div
                        className={`${s["time-fill"]} ${over ? s["time-over"] : ""}`}
                        style={{ width: `${original === 0 && over ? 100 : Math.min(100, summary.percent)}%` }}
                    />
                </div>
            )}

            <div className={s["time-actions"]}>
                {canLogWork && <button type="button" className={s["time-button"]} onClick={() => setOpen(true)}>Log work</button>}
                {over && <span className={s["time-over-label"]}>Over estimate</span>}
            </div>

            <WorklogWarnings warnings={warnings} />
            {taskId && <TaskWorklogList taskId={taskId} revision={`${revision}:${task?.time_spent_minutes ?? task?.logged_minutes ?? 0}`} saved={saved} deleted={deleted} onEdit={setEditing} onDelete={setDeleting} onTotal={revision > 0 ? setLogged : undefined} />}
            {deleting && <DeleteWorklogDialog taskId={taskId} worklog={deleting} onClose={() => setDeleting(undefined)} onDeleted={ticket => {
                setLogged(ticket.time_spent_minutes);
                setEstimates(ticket);
                setDeleted(current => [...current, deleting.id]);
                setSaved(current => current.filter(row => row.id !== deleting.id));
                setDeleting(undefined);
                onLogged?.(-deleting.minutes);
            }} />}
            {(editing || (open && canLogWork)) && <LogWorkDialog key={editing?.id ?? 'new'} taskId={taskId} worklog={editing} onClose={() => { setOpen(false); setEditing(undefined); }} onSaved={onSaved} />}
        </section>
    );
}