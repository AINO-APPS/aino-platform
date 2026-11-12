import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getScheduleOverlays, getTasks, updateTask } from "../../api/tasks";
import useRealtimeEvent from "../../hooks/useRealtimeEvent";
import { addDays, monthGrid, parseDateString, toDateString, weekDays } from "./calendar";
import { overlayItems, type OverlayType } from "./overlays";
import { actionDecision, decisionProps, writeError } from "./ticketCapabilities";
import type { Task, TaskCollectionResponse } from "../../types/generated/tasks";
import s from "./TaskCalendar.module.css";
import shared from "./TaskPlanning.module.css";

async function calendarTickets(projectId: number, params: Record<string, string>, signal: AbortSignal) {
    const tickets: Task[] = [];
    for (let offset = 0; ; offset += 500) {
        const { data } = await getTasks<TaskCollectionResponse>(undefined, { scope: "calendar", project_id: projectId, ...params, offset }, signal);
        tickets.push(...data.tasks);
        if (!data.pagination?.hasMore) return tickets;
    }
}

export default function TaskCalendar({ project, onOpenDetail, updatedTicket, today = toDateString(new Date()) }: {
    project: any; onOpenDetail: (ticket: any) => void; updatedTicket?: any; today?: string;
}) {
    const client = useQueryClient();
    const [anchor, setAnchor] = useState(today);
    const [mode, setMode] = useState<"month" | "week">("month");
    const [visible, setVisible] = useState<Record<OverlayType, boolean>>({ leave: true, holidays: true, meetings: true });
    const [editing, setEditing] = useState<Task | null>(null);
    const startInput = useRef<HTMLInputElement>(null);
    useEffect(() => { if (editing) startInput.current?.focus(); }, [editing]);
    const [startDate, setStartDate] = useState("");
    const [dueDate, setDueDate] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [dragging, setDragging] = useState<{ ticket: Task; from: string | null } | null>(null);
    const days = useMemo(() => mode === "week" ? weekDays(anchor, today) : monthGrid(anchor, today), [anchor, today, mode]);
    const from = days[0].date;
    const to = days[days.length - 1].date;
    const dated = useQuery({
        queryKey: ["projectCalendar", Number(project.id), from, to],
        queryFn: ({ signal }) => calendarTickets(project.id, { start_date: from, end_date: to }, signal),
    });
    const tray = useQuery({
        queryKey: ["projectCalendar", Number(project.id), "undated"],
        queryFn: ({ signal }) => calendarTickets(project.id, { undated: "1" }, signal),
    });
    const overlays = useQuery({
        queryKey: ["calendarOverlays", from, to],
        queryFn: async () => (await getScheduleOverlays(from, to)).data,
    });
    const refresh = useCallback(() => { void dated.refetch(); void tray.refetch(); }, [dated.refetch, tray.refetch]);
    useRealtimeEvent(["task_updated", "project_updated"], refresh);
    useEffect(() => { if (updatedTicket) refresh(); }, [updatedTicket, refresh]);
    const context = useMemo(() => overlayItems(overlays.data), [overlays.data]);
    async function saveDates(ticket: Task, start: string | null, due: string | null) {
        setError("");
        setNotice("");
        if (start && due && due < start) {
            setError("Due date cannot be earlier than the start date");
            return;
        }
        if (!actionDecision(ticket, "edit").allowed || saving) return;
        setSaving(true);
        try {
            await updateTask(ticket.id, { start_date: start, due_date: due });
            await Promise.all([
                dated.refetch(), tray.refetch(),
                client.invalidateQueries({ queryKey: ["projectList", Number(project.id)] }),
                client.invalidateQueries({ queryKey: ["projectBoard", Number(project.id)] }),
            ]);
            setEditing(null);
            setNotice("Dates saved");
        } catch (err) {
            setError(writeError(err, "Could not save ticket dates."));
            refresh();
        } finally { setSaving(false); }
    }
    function step(amount: number) {
        if (mode === "week") { setAnchor(addDays(anchor, amount * 7)); return; }
        const date = parseDateString(`${anchor.slice(0, 7)}-01`);
        date.setMonth(date.getMonth() + amount);
        setAnchor(toDateString(date));
    }
    function ticketCard(ticket: Task, sourceDate: string | null) {
        const editable = actionDecision(ticket, "edit").allowed && !saving;
        return <article key={ticket.id} className={s.ticket} draggable={editable}
            onDragStart={event => {
                if (!editable) { event.preventDefault(); return; }
                event.dataTransfer.setData("text/plain", String(ticket.id));
                event.dataTransfer.effectAllowed = "move";
                setDragging({ ticket, from: sourceDate });
            }} onDragEnd={() => setDragging(null)}>
            <span className={shared.key}>{ticket.ticket_key}</span>
            <button type="button" className={shared.title} onClick={() => onOpenDetail(ticket)}>{ticket.title}</button>
            <button type="button" className={s.edit} aria-label={`Edit dates for ${ticket.ticket_key}`}
                {...decisionProps(actionDecision(ticket, "edit"))} disabled={!editable} onClick={() => {
                    setEditing(ticket); setStartDate(ticket.start_date?.slice(0, 10) ?? "");
                    setDueDate(ticket.due_date?.slice(0, 10) ?? ""); setError(""); setNotice("");
                }}>Edit dates</button>
        </article>;
    }
    return <section className={shared.surface} aria-label="Project calendar">
        <div className={shared.toolbar}><div><span className={shared.eyebrow}>MAKE ROOM FOR THE WORK</span>
            <p>Drag to move dates together, or use Edit dates. Undated work waits alongside.</p></div>
            <div className={s.nav}>
                <div className={s.mode} role="group" aria-label="Calendar view">
                    <button aria-pressed={mode === "month"} onClick={() => setMode("month")}>Month</button>
                    <button aria-pressed={mode === "week"} onClick={() => setMode("week")}>Week</button>
                </div>
                <button aria-label={`Previous ${mode}`} onClick={() => step(-1)}>←</button>
                <label className={shared.srOnly} htmlFor="task-calendar-anchor">{mode === "month" ? "Calendar month" : "Calendar week containing"}</label>
                <input id="task-calendar-anchor" type={mode === "month" ? "month" : "date"}
                    value={mode === "month" ? anchor.slice(0, 7) : anchor}
                    onChange={event => { if (event.target.value) setAnchor(mode === "month" ? `${event.target.value}-01` : event.target.value); }} />
                <button aria-label={`Next ${mode}`} onClick={() => step(1)}>→</button>
                <button onClick={() => setAnchor(today)}>Today</button>
            </div>
        </div>
        {mode === "week" && <p className={s.range} aria-live="polite">
            <time dateTime={from}>{parseDateString(from).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</time>
            {" — "}<time dateTime={to}>{parseDateString(to).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</time>
        </p>}
        <div className={s.legend} role="group" aria-label="Calendar overlays">
            {(["leave", "holidays", "meetings"] as OverlayType[]).map(type => <label key={type}>
                <input type="checkbox" checked={visible[type]} onChange={() => setVisible(value => ({ ...value, [type]: !value[type] }))} />
                {type === "leave" ? "Approved leave" : type === "holidays" ? "Holidays" : "Meetings"}
            </label>)}
            <span>Read-only context</span>
        </div>
        {(dated.isError || tray.isError) && <p role="alert">Could not load calendar tickets. <button onClick={refresh}>Retry</button></p>}
        {overlays.isError && <p role="alert">Calendar context is unavailable. <button onClick={() => void overlays.refetch()}>Retry overlays</button></p>}
        {(dated.isLoading || tray.isLoading) && <p role="status">Loading calendar…</p>}
        {error && <p role="alert" className={s.error}>{error}</p>}
        {notice && <p role="status" className={s.notice}>{notice}</p>}
        {editing && <form className={s.editor} aria-label={`Dates for ${editing.ticket_key}`}
            onSubmit={event => { event.preventDefault(); void saveDates(editing, startDate || null, dueDate || null); }}>
            <strong>{editing.ticket_key}</strong>
            <label>Start date<input ref={startInput} type="date" value={startDate} onChange={event => setStartDate(event.target.value)} disabled={saving} /></label>
            <label>Due date<input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} disabled={saving} /></label>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>Save dates</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => setEditing(null)}>Cancel</button>
        </form>}
        <div className={s.layout}>
            <div className={s.gridScroll}>
                <div className={s.weekdays} aria-hidden="true">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <span key={day}>{day}</span>)}</div>
                <div className={`${s.grid} ${mode === "week" ? s.week : ""}`}>
                    {days.map(day => <section key={day.date} role="group" aria-label={day.date}
                        onDragOver={event => { if (dragging && !saving) event.preventDefault(); }}
                        onDrop={event => {
                            event.preventDefault();
                            if (!dragging || saving) return;
                            const { ticket, from: source } = dragging;
                            const delta = source ? Math.round((Date.parse(day.date) - Date.parse(source)) / 86400000) : 0;
                            const start = ticket.start_date ? addDays(ticket.start_date.slice(0, 10), delta) : source ? null : day.date;
                            const due = ticket.due_date ? addDays(ticket.due_date.slice(0, 10), delta) : source ? null : day.date;
                            setDragging(null);
                            void saveDates(ticket, start, due);
                        }}
                        className={`${s.day} ${!day.inMonth ? s.outside : ""} ${day.isToday ? s.today : ""}`}>
                        <time dateTime={day.date}>{Number(day.date.slice(8))}</time>
                        {context.filter(item => item.date === day.date && visible[item.type]).map(item =>
                            <span key={item.id} className={s.overlay} data-type={item.type} draggable={false}>{item.label}</span>)}
                        {(dated.data ?? []).filter(ticket => {
                            const start = ticket.start_date?.slice(0, 10) ?? ticket.due_date?.slice(0, 10);
                            const due = ticket.due_date?.slice(0, 10) ?? ticket.start_date?.slice(0, 10);
                            return start && due && start <= day.date && due >= day.date;
                        }).map(ticket => ticketCard(ticket, day.date))}
                    </section>)}
                </div>
            </div>
            <aside className={s.tray} aria-label="Undated open tickets">
                <span className={shared.eyebrow}>NEXT TO PLAN</span><h3>Undated <span>{tray.data?.length ?? 0}</span></h3>
                <p>No start date or due date.</p>
                {(tray.data ?? []).map(ticket => ticketCard(ticket, null))}
                {!tray.isLoading && !tray.isError && !tray.data?.length && <p>Everything has a date.</p>}
            </aside>
        </div>
    </section>;
}
