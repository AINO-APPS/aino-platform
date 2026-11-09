import { useEffect, useState, type FormEvent } from "react";
import { createTaskSubtask } from "../../api/tasks";
import s from "./SubtasksPanel.module.css";

interface SubtaskSummary { id: number | string; title: string; ticket_key?: string | null; state_name?: string | null; completed_at?: string | null }
interface Props {
    task: {
        id: number | string;
        subtasks?: SubtaskSummary[];
        capabilities?: { can?: { canAddSubtask?: { allowed: boolean; reason?: string } } };
    };
    onOpenTask?: (id: number | string) => void;
    onChanged?: () => void;
}

export default function SubtasksPanel({ task, onOpenTask, onChanged }: Props) {
    const [subtasks, setSubtasks] = useState(task.subtasks || []);
    const [adding, setAdding] = useState(false);
    const [title, setTitle] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const canAdd = task.capabilities?.can?.canAddSubtask?.allowed === true;
    useEffect(() => {
        setSubtasks(task.subtasks || []);
        setAdding(false); setTitle(""); setError("");
    }, [task.id, task.subtasks]);

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (!canAdd || busy || !title.trim()) return;
        setBusy(true); setError("");
        try {
            const result = await createTaskSubtask(task.id, { title: title.trim() });
            setSubtasks((rows) => [...rows, result.data]);
            setAdding(false); setTitle("");
            onChanged?.();
        } catch (failure) {
            const message = (failure as { response?: { data?: { error?: string } } }).response?.data?.error;
            setError(message || "Could not create subtask. Try again.");
        } finally { setBusy(false); }
    }

    if (!canAdd && !subtasks.length) return null;
    return <section className={s.panel} aria-label="Subtasks">
        <div className={s.header}>
            <h4>Subtasks <span>{subtasks.filter(row => row.completed_at != null).length}/{subtasks.length} done</span></h4>
            {canAdd && !adding && <button type="button" className="btn btn-secondary btn-sm"
                onClick={() => setAdding(true)}>Add subtask</button>}
        </div>
        {subtasks.length > 0 ? <ul className={s.list}>{subtasks.map((subtask) => <li key={subtask.id}>
            <a href={`/tasks?task=${subtask.id}`} onClick={(event) => {
                if (onOpenTask) { event.preventDefault(); onOpenTask(subtask.id); }
            }}><span className={s.key}>{subtask.ticket_key || `#${subtask.id}`}</span> {subtask.title}</a>
            {subtask.state_name && <span className={s.state}>{subtask.state_name}</span>}
        </li>)}</ul> : <p className={s.empty}>Break this ticket into smaller pieces. Project and sprint follow the parent.</p>}
        {adding && canAdd && <form className={s.form} onSubmit={submit}>
            <label htmlFor={`subtask-title-${task.id}`}>Subtask title</label>
            <input id={`subtask-title-${task.id}`} autoFocus value={title} maxLength={200} required
                onChange={(event) => setTitle(event.target.value)} disabled={busy} />
            <div className={s.actions}>
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !title.trim()}>
                    {busy ? "Creating…" : "Create subtask"}</button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy}
                    onClick={() => { setAdding(false); setError(""); }}>Cancel</button>
            </div>
        </form>}
        {error && <p className={s.error} role="alert">{error}</p>}
    </section>;
}
