import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { deleteTaskWorklog, type TaskWorklog, type WorklogTicketSummary } from '../../api/tasks';
import { formatMinutes } from './time';
import s from './LogWorkDialog.module.css';
import RemainingEstimateChoice, { useRemainingChoice } from './RemainingEstimateChoice';

export default function DeleteWorklogDialog({ taskId, worklog, onClose, onDeleted }: {
    taskId: number; worklog: TaskWorklog; onClose: () => void; onDeleted: (ticket: WorklogTicketSummary) => void;
}) {
    const id = useId();
    const dialog = useRef<HTMLDialogElement>(null);
    const pending = useRef(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const remaining = useRemainingChoice();
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        const element = dialog.current!;
        if (element.showModal) element.showModal();
        else element.setAttribute('open', '');
        element.querySelector('button')?.focus();
        return () => { element.close?.(); previous?.focus(); };
    }, []);
    const remove = async () => {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError('');
        try {
            const { data } = await deleteTaskWorklog(taskId, worklog.id, remaining.payload);
            onDeleted(data.ticket);
        } catch (err) {
            setError((err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Could not delete worklog. Please try again.');
        } finally { pending.current = false; setBusy(false); }
    };
    return createPortal(<dialog ref={dialog} className={s.dialog} aria-labelledby={`${id}-title`}
        onCancel={event => { event.preventDefault(); if (!pending.current) onClose(); }}
        onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
        <header><p className={s.eyebrow}>Ticket worklog</p><h2 id={`${id}-title`}>Delete worklog?</h2>
            <p className={s.hint}>Remove {formatMinutes(worklog.minutes)} on {worklog.day_worked} from time spent? The worklog stays in ticket history.</p></header>
        <RemainingEstimateChoice choice={remaining} disabled={busy} />
        {error && <p role="alert" className={s.error}>{error}</p>}
        <footer className={s.actions}>
            <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
            <button type="button" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete worklog'}</button>
        </footer>
    </dialog>, document.body);
}
