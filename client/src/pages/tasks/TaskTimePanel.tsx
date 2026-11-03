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
    const taskId = task?.id;
    const canLogWork = actionDecision(task, 'logWork').allowed;
    useEffect(() => { setLogged(null); setSaved([]); setOpen(false); setEditing(undefined); setDeleting(undefined); setDeleted([]); setRevision(0); setWarnings([]); }, [taskId]);
    useRealtimeEvent(['task_updated'], event => {
        if (String((event.data as { taskId?: number })?.taskId) !== String(taskId)) return;
        setSaved([]);
        setDeleted([]);
        setRevision(value => value + 1);
    }, !!taskId);
    const onSaved = (response: LogWorkResponse) => {
        setWarnings(response.warnings);
        setLogged(response.ticket.time_spent_minutes);
        setSaved(current => [response.worklog, ...current.filter(row => row.id !== response.worklog.id)]);
        setOpen(false);
        setEditing(undefined);
        onLogged?.(response.worklog.minutes);
    };
    const summary = summariseTime({
        estimated_minutes: task?.estimated_minutes,
        logged_minutes: logged ?? task?.time_spent_minutes ?? task?.logged_minutes,
    });

    return (
        <section className={s["time-panel"]} aria-label="Time tracking">
            <div className={s["time-row"]}>
                <span className={s["time-label"]}>Time spent</span>
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
                {canLogWork && <button type="button" className={s["time-button"]} onClick={() => setOpen(true)}>Log work</button>}
                {summary.over && <span className={s["time-over-label"]}>Over estimate</span>}
            </div>

            <WorklogWarnings warnings={warnings} />
            {taskId && <TaskWorklogList taskId={taskId} revision={`${revision}:${task?.time_spent_minutes ?? task?.logged_minutes ?? 0}`} saved={saved} deleted={deleted} onEdit={setEditing} onDelete={setDeleting} onTotal={revision > 0 ? setLogged : undefined} />}
            {deleting && <DeleteWorklogDialog taskId={taskId} worklog={deleting} onClose={() => setDeleting(undefined)} onDeleted={ticket => {
                setLogged(ticket.time_spent_minutes);
                setDeleted(current => [...current, deleting.id]);
                setSaved(current => current.filter(row => row.id !== deleting.id));
                setDeleting(undefined);
                onLogged?.(-deleting.minutes);
            }} />}
            {(editing || (open && canLogWork)) && <LogWorkDialog key={editing?.id ?? 'new'} taskId={taskId} worklog={editing} onClose={() => { setOpen(false); setEditing(undefined); }} onSaved={onSaved} />}
        </section>
    );
}