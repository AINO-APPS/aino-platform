import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAssignableUsers, getTasks } from "../../api/tasks";
import { useAgileConfig } from "../../AgileConfigContext";
import useRealtimeEvent from "../../hooks/useRealtimeEvent";
import type { TaskCollectionResponse } from "../../types/generated/tasks";
import s from "./TaskPlanning.module.css";

const fields = [
    ["key", "Key"], ["title", "Title"], ["type", "Type"], ["status", "Status"],
    ["assignee", "Assignee"], ["priority", "Priority"], ["start_date", "Start date"], ["due_date", "Due date"],
] as const;
const filterKey: Record<string, string> = { type: "work_item_type_id", start_date: "start_on", due_date: "due_on" };

export default function TaskListView({ project, onOpenDetail, updatedTicket }: {
    project: any; onOpenDetail: (ticket: any) => void; updatedTicket?: any;
}) {
    const [filters, setFilters] = useState<Record<string, string>>({});
    const [sort, setSort] = useState("key");
    const [direction, setDirection] = useState("asc");
    const [offset, setOffset] = useState(0);
    const { workItemTypes = [], workflowStates = [] } = useAgileConfig() ?? {};
    const { data: users = [] } = useQuery({
        queryKey: ["tasks", "assignableUsers"], queryFn: async () => (await getAssignableUsers()).data as any[],
    });
    const { data, isLoading, isError, refetch } = useQuery({
        queryKey: ["projectList", Number(project.id), filters, sort, direction, offset],
        queryFn: async ({ signal }) => (await getTasks<TaskCollectionResponse>(undefined, {
            ...filters, scope: "list", project_id: project.id, sort, direction, offset,
        }, signal)).data,
    });
    const refresh = useCallback(() => { void refetch(); }, [refetch]);
    useRealtimeEvent(["task_updated", "project_updated"], refresh);
    useEffect(() => { if (updatedTicket) refresh(); }, [updatedTicket, refresh]);
    const tickets = data?.tasks ?? [];
    function filter(field: string, value: string) {
        setOffset(0);
        setFilters(previous => ({ ...previous, [filterKey[field] ?? field]: value }));
    }
    function sortBy(field: string) {
        setOffset(0);
        setSort(field);
        setDirection(sort === field && direction === "asc" ? "desc" : "asc");
    }
    const options: Record<string, { value: string; label: string }[]> = {
        type: workItemTypes.map(type => ({ value: String(type.id), label: type.name })),
        status: workflowStates.map(state => ({ value: state.key, label: state.name })),
        assignee: [{ value: "unassigned", label: "Unassigned" }, ...users.map(user => ({ value: String(user.id), label: user.full_name || user.username }))],
        priority: ["high", "medium", "low"].map(value => ({ value, label: value })),
    };
    return <section className={s.surface} aria-label="Project task list">
        <div className={s.toolbar}><div><span className={s.eyebrow}>WORK, AT A GLANCE</span>
            <p>Every ticket in this project. Sort a column; narrow the work below it.</p></div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFilters({}); setOffset(0); }}>Clear filters</button>
        </div>
        {isError && <p role="alert">Could not load project tickets. <button onClick={refresh}>Retry</button></p>}
        {isLoading && <p role="status">Loading project tickets…</p>}
        <div className={s.tableScroll}>
            <table className={s.table}>
                <caption className={s.srOnly}>Project tickets, sortable and filterable by each column</caption>
                <thead>
                    <tr>{fields.map(([field, label]) => <th key={field} scope="col"
                        aria-sort={sort === field ? direction === "asc" ? "ascending" : "descending" : "none"}>
                        <button type="button" onClick={() => sortBy(field)}>{label}<span aria-hidden="true">{sort === field ? direction === "asc" ? " ↑" : " ↓" : ""}</span></button>
                    </th>)}</tr>
                    <tr>{fields.map(([field, label]) => <td key={field}>
                        {options[field] ? <select aria-label={`Filter ${label.toLowerCase()}`} value={filters[filterKey[field] ?? field] ?? ""}
                            onChange={event => filter(field, event.target.value)}>
                            <option value="">All</option>{options[field].map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select> : <input type={field.endsWith("_date") ? "date" : "search"} aria-label={`Filter ${label.toLowerCase()}`}
                            value={filters[filterKey[field] ?? field] ?? ""} onChange={event => filter(field, event.target.value)} />}
                    </td>)}</tr>
                </thead>
                <tbody>{tickets.map(ticket => <tr key={ticket.id}>
                    <td className={s.key}>{ticket.ticket_key}</td>
                    <td><button className={s.title} onClick={() => onOpenDetail(ticket)}>{ticket.title}</button></td>
                    <td>{workItemTypes.find(type => type.id === ticket.work_item_type_id)?.name ?? "—"}</td>
                    <td><span className={s.state}>{ticket.workflow_state_name}</span></td>
                    <td>{ticket.assignee?.full_name || ticket.assignee?.username || "Unassigned"}</td>
                    <td><span className={s.priority} data-priority={ticket.priority}>{ticket.priority}</span></td>
                    <td>{ticket.start_date?.slice(0, 10) || "—"}</td><td>{ticket.due_date?.slice(0, 10) || "—"}</td>
                </tr>)}</tbody>
            </table>
        </div>
        {!isLoading && !isError && !tickets.length && <p className={s.empty}>No tickets match these filters.</p>}
        <div className={s.pagination} aria-label="Ticket pages">
            <span>{tickets.length ? `${offset + 1}–${offset + tickets.length}` : "0"} tickets</span>
            <button type="button" disabled={!offset || isLoading} onClick={() => setOffset(value => Math.max(0, value - 500))}>Previous page</button>
            <button type="button" disabled={!data?.pagination?.hasMore || isLoading} onClick={() => setOffset(value => value + 500)}>Next page</button>
        </div>
    </section>;
}
