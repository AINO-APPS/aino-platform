import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { logTaskWork, editTaskWorklog, type LogWorkInput, type LogWorkResponse, type TaskWorklog } from '../../api/tasks';
import { formatMinutes } from './time';
import s from './LogWorkDialog.module.css';

function today() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function LogWorkDialog({ taskId, worklog, onClose, onSaved }: {
    taskId: number; worklog?: TaskWorklog; onClose: () => void; onSaved: (response: LogWorkResponse) => void;
}) {
    const id = useId();
    const dialog = useRef<HTMLDialogElement>(null);
    const [dayWorked, setDayWorked] = useState(() => worklog?.day_worked ?? today());
    const [timeSpent, setTimeSpent] = useState(() => worklog ? formatMinutes(worklog.minutes) : '');
    const [startTime, setStartTime] = useState(() => worklog?.start_time?.slice(0, 5) ?? '');
    const [comment, setComment] = useState(() => worklog?.comment ?? '');
    const patch: Partial<LogWorkInput> = worklog ? {
        ...(dayWorked !== worklog.day_worked ? { day_worked: dayWorked } : {}),
        ...(timeSpent !== formatMinutes(worklog.minutes) ? { time_spent: timeSpent } : {}),
        ...(startTime !== (worklog.start_time?.slice(0, 5) ?? '') ? { start_time: startTime || null } : {}),
        ...(comment !== (worklog.comment ?? '') ? { comment: comment || null } : {}),
    } : {};
    const unchanged = !!worklog && !Object.keys(patch).length;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [durationError, setDurationError] = useState(false);
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        const element = dialog.current!;
        if (element.showModal) element.showModal();
        else element.setAttribute('open', '');
        element.querySelector('input')?.focus();
        return () => { element.close?.(); previous?.focus(); };
    }, []);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busy || unchanged) return;
        setBusy(true);
        setError('');
        setDurationError(false);
        try {
            const { data } = worklog ? await editTaskWorklog(taskId, worklog.id, patch) : await logTaskWork(taskId, {
                day_worked: dayWorked, time_spent: timeSpent,
                ...(startTime ? { start_time: startTime } : {}), ...(comment ? { comment } : {}),
            });
            onSaved(data);
        } catch (err) {
            const data = (err as { response?: { data?: { code?: string; error?: string } } })?.response?.data;
            setDurationError(data?.code === 'INVALID_DURATION');
            setError(data?.error || 'Could not log work. Please try again.');
        } finally { setBusy(false); }
    };

    return createPortal(<dialog ref={dialog} className={s.dialog} aria-labelledby={`${id}-title`}
        onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
        onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }}>
        <form onSubmit={submit}>
            <header><p className={s.eyebrow}>Ticket worklog</p><h2 id={`${id}-title`}>{worklog ? 'Edit worklog' : 'Log work'}</h2>
                <p className={s.hint}>Record the time you spent, including work from earlier days.</p></header>
            <fieldset disabled={busy} className={s.fields}>
                <label htmlFor={`${id}-day`}>Day worked</label>
                <input id={`${id}-day`} type="date" required value={dayWorked} onChange={event => setDayWorked(event.target.value)} />
                <label htmlFor={`${id}-duration`}>Time spent</label>
                <input id={`${id}-duration`} required placeholder="2h 30m" value={timeSpent}
                    aria-invalid={durationError} aria-describedby={`${id}-help${durationError ? ` ${id}-error` : ''}`}
                    onChange={event => { setTimeSpent(event.target.value); setDurationError(false); setError(''); }} />
                <p id={`${id}-help`} className={s.hint}>Use weeks, working days, hours or minutes: 1w 2d 3h 30m.</p>
                {durationError && <p id={`${id}-error`} className={s.error} role="alert">{error}</p>}
                <label htmlFor={`${id}-start`}>Start time (optional)</label>
                <input id={`${id}-start`} type="time" value={startTime} onChange={event => setStartTime(event.target.value)} />
                <label htmlFor={`${id}-comment`}>Comment (optional)</label>
                <textarea id={`${id}-comment`} rows={3} maxLength={10000} value={comment} onChange={event => setComment(event.target.value)} />
            </fieldset>
            {error && !durationError && <p className={s.error} role="alert">{error}</p>}
            <footer className={s.actions}>
                <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
                <button className={s.primary} type="submit" disabled={busy || unchanged}>{busy ? 'Saving…' : 'Save work'}</button>
            </footer>
        </form>
    </dialog>, document.body);
}
