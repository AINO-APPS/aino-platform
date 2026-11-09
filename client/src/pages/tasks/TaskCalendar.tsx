import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getScheduleOverlays, getTasks, updateTask } from "../../api/tasks";
import useRealtimeEvent from "../../hooks/useRealtimeEvent";
import { addDays, monthGrid, parseDateString, toDateString } from "./calendar";
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
    const [anchor, setAnchor] = useState(today.slice(0, 7));
    const [visible, setVisible] = useState<Record<OverlayType, boolean>>({ leave: true, holidays: true, meetings: true });
    const [editing, setEditing] = useState<Task | null>(null);
    const [startDate, setStartDate] = useState("");
    const [dueDate, setDueDate] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [dragging, setDragging] = useState<{ ticket: Task; from: string | null } | null>(null);
    const days = useMemo(() => monthGrid(`${anchor}-01`, today), [anchor, today]);
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
        const date = parseDateString(`${anchor}-01`);
        date.setMonth(date.getMonth() + amount);
        setAnchor(toDateString(date).slice(0, 7));
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
                <button aria-label="Previous month" onClick={() => step(-1)}>←</button>
                <label className={shared.srOnly} htmlFor="task-calendar-month">Calendar month</label>
                <input id="task-calendar-month" type="month" value={anchor} onChange={event => { if (event.target.value) setAnchor(event.target.value); }} />
                <button aria-label="Next month" onClick={() => step(1)}>→</button>
                <button onClick={() => setAnchor(today.slice(0, 7))}>Today</button>
            </div>
        </div>
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
            <label>Start date<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} disabled={saving} /></label>
            <label>Due date<input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} disabled={saving} /></label>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>Save dates</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => setEditing(null)}>Cancel</button>
        </form>}
        <div className={s.layout}>
            <div className={s.gridScroll}>
                <div className={s.weekdays} aria-hidden="true">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => <span key={day}>{day}</span>)}</div>
                <div className={s.grid}>
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
