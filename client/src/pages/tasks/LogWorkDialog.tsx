import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { logTaskWork, editTaskWorklog, getAssignableUsers, type LogWorkInput, type LogWorkResponse, type TaskWorklog } from '../../api/tasks';
import { formatMinutes } from './time';
import s from './LogWorkDialog.module.css';
import RemainingEstimateChoice, { useRemainingChoice } from './RemainingEstimateChoice';

function today() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function LogWorkDialog({ taskId, worklog, canLogWorkForOthers = false, onClose, onSaved }: {
    taskId: number; worklog?: TaskWorklog; canLogWorkForOthers?: boolean;
    onClose: () => void; onSaved: (response: LogWorkResponse) => void;
}) {
    const id = useId();
    const dialog = useRef<HTMLDialogElement>(null);
    const [dayWorked, setDayWorked] = useState(() => worklog?.day_worked ?? today());
    const [timeSpent, setTimeSpent] = useState(() => worklog ? formatMinutes(worklog.minutes) : '');
    const [startTime, setStartTime] = useState(() => worklog?.start_time?.slice(0, 5) ?? '');
    const [comment, setComment] = useState(() => worklog?.comment ?? '');
    const [authorId, setAuthorId] = useState(() => worklog ? String(worklog.author_id) : '');
    const [people, setPeople] = useState<Array<{ id: number; username: string; full_name: string | null }>>([]);
    const [peopleState, setPeopleState] = useState<'loading' | 'ready' | 'error'>('loading');
    useEffect(() => {
        if (!canLogWorkForOthers) return;
        let cancelled = false;
        getAssignableUsers().then(({ data }) => {
            if (!cancelled) { setPeople(data); setPeopleState('ready'); }
        }).catch(() => { if (!cancelled) setPeopleState('error'); });
        return () => { cancelled = true; };
    }, [canLogWorkForOthers]);
    const patch: Partial<LogWorkInput> = worklog ? {
        ...(canLogWorkForOthers && authorId !== String(worklog.author_id) ? { author_id: Number(authorId) } : {}),
        ...(dayWorked !== worklog.day_worked ? { day_worked: dayWorked } : {}),
        ...(timeSpent !== formatMinutes(worklog.minutes) ? { time_spent: timeSpent } : {}),
        ...(startTime !== (worklog.start_time?.slice(0, 5) ?? '') ? { start_time: startTime || null } : {}),
        ...(comment !== (worklog.comment ?? '') ? { comment: comment || null } : {}),
    } : {};
    const remaining = useRemainingChoice();
    const unchanged = !!worklog && !Object.keys(patch).length && remaining.mode === 'auto';
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
            const { data } = worklog ? await editTaskWorklog(taskId, worklog.id, { ...patch, ...remaining.payload }) : await logTaskWork(taskId, {
                ...remaining.payload,
                day_worked: dayWorked, time_spent: timeSpent,
                ...(canLogWorkForOthers && authorId ? { author_id: Number(authorId) } : {}),
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
                {canLogWorkForOthers && <>
                    <label htmlFor={`${id}-person`}>Person</label>
                    <select id={`${id}-person`} value={authorId} disabled={peopleState !== 'ready'} onChange={event => setAuthorId(event.target.value)}>
                        {!worklog && <option value="">Myself</option>}
                        {worklog && !people.some(person => person.id === worklog.author_id) && <option value={worklog.author_id}>{worklog.author.full_name || worklog.author.username}</option>}
                        {people.map(person => <option key={person.id} value={person.id}>{person.full_name || person.username}</option>)}
                    </select>
                    {peopleState === 'loading' && <p role="status" className={s.hint}>Loading people…</p>}
                    {peopleState === 'error' && <p role="alert" className={s.error}>Could not load people. Close and reopen to try again.</p>}
                </>}
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
            <RemainingEstimateChoice choice={remaining} disabled={busy} />
            {error && !durationError && <p className={s.error} role="alert">{error}</p>}
            <footer className={s.actions}>
                <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
                <button className={s.primary} type="submit" disabled={busy || unchanged}>{busy ? 'Saving…' : 'Save work'}</button>
            </footer>
        </form>
    </dialog>, document.body);
}
