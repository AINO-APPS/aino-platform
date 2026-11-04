import { useEffect, useState } from "react";
import { getTaskWorklogs, type TaskWorklog, type TaskWorklogListResponse } from "../../api/tasks";
import { formatMinutes } from "./time";
import s from "./TaskTimePanel.module.css";

export default function TaskWorklogList({ taskId, revision, saved, deleted, onSummary, onEdit, onDelete }: {
    taskId: number; revision: unknown; saved?: TaskWorklog[]; deleted?: number[]; onSummary?: (summary: TaskWorklogListResponse) => void;
    onEdit?: (worklog: TaskWorklog) => void; onDelete?: (worklog: TaskWorklog) => void;
}) {
    const [worklogs, setWorklogs] = useState<TaskWorklog[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(false);
        setWorklogs([]);
        getTaskWorklogs(taskId).then(({ data }) => {
            if (!cancelled) { setWorklogs(data.worklogs); onSummary?.(data); }
        }).catch(() => {
            if (!cancelled) setError(true);
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [taskId, revision]);

    const visible = [...worklogs.filter(row => !saved?.some(entry => entry.id === row.id)), ...(saved ?? [])]
        .filter(row => !deleted?.includes(row.id))
        .sort((a, b) => b.day_worked.localeCompare(a.day_worked) || String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id);
    return <div className={s["worklogs"]}>
        <h3 className={s["worklog-heading"]}>Worklogs</h3>
        {loading && !saved?.length ? <p role="status" className={s["worklog-meta"]}>Loading worklogs…</p>
            : error && !saved?.length ? <p role="alert" className={s["time-error"]}>Could not load worklogs</p>
            : !visible.length ? <p className={s["worklog-meta"]}>No work logged yet</p>
            : <ol aria-label="Worklogs" className={s["worklog-list"]}>
                {visible.map(worklog => <li key={worklog.id} className={s["worklog-entry"]}>
                    <div className={s["time-row"]}>
                        <strong>{worklog.author.full_name || worklog.author.username}</strong>
                        <span className={s["time-value"]}>{formatMinutes(worklog.minutes)}</span>
                    </div>
                    <div className={s["worklog-meta"]}>
                        <time dateTime={worklog.day_worked}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${worklog.day_worked}T00:00:00Z`))}</time>
                        {worklog.start_time && <span> · {worklog.start_time.slice(0, 5)}</span>}
                        {worklog.author_id !== worklog.logged_by_id && <span> · Logged by {worklog.logged_by.full_name || worklog.logged_by.username}</span>}
                    </div>
                    {worklog.comment && <p className={s["worklog-comment"]}>{worklog.comment}</p>}
                    {(worklog.canEdit || worklog.canDelete) && <div className={s["time-actions"]}>
                        {worklog.canEdit && <button type="button" className={s["time-button"]} aria-label="Edit worklog" onClick={() => onEdit?.(worklog)}>Edit</button>}
                        {worklog.canDelete && <button type="button" className={s["time-button"]} aria-label="Delete worklog" onClick={() => onDelete?.(worklog)}>Delete</button>}
                    </div>}
                </li>)}
            </ol>}
    </div>;
}
