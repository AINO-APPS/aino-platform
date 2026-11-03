import { useEffect, useState } from "react";
import { getTaskWorklogs, type TaskWorklog } from "../../api/tasks";
import { formatMinutes } from "./time";
import s from "./TaskTimePanel.module.css";

export default function TaskWorklogList({ taskId, revision }: { taskId: number; revision: unknown }) {
    const [worklogs, setWorklogs] = useState<TaskWorklog[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(false);
        setWorklogs([]);
        getTaskWorklogs(taskId).then(({ data }) => {
            if (!cancelled) setWorklogs(data.worklogs);
        }).catch(() => {
            if (!cancelled) setError(true);
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [taskId, revision]);

    return <div className={s["worklogs"]}>
        <h3 className={s["worklog-heading"]}>Worklogs</h3>
        {loading ? <p role="status" className={s["worklog-meta"]}>Loading worklogs…</p>
            : error ? <p role="alert" className={s["time-error"]}>Could not load worklogs</p>
            : !worklogs.length ? <p className={s["worklog-meta"]}>No work logged yet</p>
            : <ol aria-label="Worklogs" className={s["worklog-list"]}>
                {worklogs.map(worklog => <li key={worklog.id} className={s["worklog-entry"]}>
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
                </li>)}
            </ol>}
    </div>;
}
