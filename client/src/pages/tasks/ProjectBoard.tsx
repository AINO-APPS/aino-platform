import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addTask, getProjectBacklog, getProjectBoard, updateProjectBoardSettings } from "../../api/tasks";
import useRealtimeEvent from "../../hooks/useRealtimeEvent";
import KanbanBoard from "./KanbanBoard";
import TaskCard from "./TaskCard";
import { useSprintBoardDrag } from "./hooks/useSprintBoardDrag";
import type { ShowConfirm } from "./hooks/useConfirmDialog";
import { boardTargetDecision, reasonCopy, writeError } from "./ticketCapabilities";
import type { BoardColumn } from "./boardTypes";
import s from "./ProjectBoard.module.css";
import PlanningSubtasks from "./PlanningSubtasks";
import { planningFamilies } from "./planningHierarchy";

interface Props {
    project: any;
    backlog?: boolean;
    updatedTicket?: any;
    onOpenDetail: (ticket: any) => void;
    onOpenComments: (id: number | string) => void;
    showConfirm: ShowConfirm;
    closeConfirm: () => void;
}

export default function ProjectBoard({ project, backlog = false, updatedTicket, onOpenDetail, onOpenComments, showConfirm, closeConfirm }: Props) {
    const client = useQueryClient();
    const [tickets, setTickets] = useState<any[]>([]);
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [creating, setCreating] = useState(false);
    const [title, setTitle] = useState("");
    const queryKey = ["projectBoard", Number(project.id), backlog];
    const { data, isLoading, isError } = useQuery({
        queryKey,
        queryFn: async ({ signal }) => (await (backlog ? getProjectBacklog : getProjectBoard)(project.id, signal)).data as any,
    });
    const currentProject = data?.project ?? project;
    const refresh = useCallback(() => { void client.invalidateQueries({ queryKey: ["projectBoard", Number(project.id)] }); }, [client, project.id]);
    useEffect(() => { setTickets(data?.tickets ?? []); }, [data]);
    useEffect(() => { if (updatedTicket) refresh(); }, [updatedTicket, refresh]);
    useRealtimeEvent(["task_updated", "project_updated"], refresh);
    const columns: BoardColumn[] = (data?.columns ?? []).map((column: any) => ({
        ...column.state, ...column, id: column.stateId,
    }));
    const { drag, boardDrag, announcement } = useSprintBoardDrag({
        tasks: tickets, setTasks: setTickets, columns, showConfirm, closeConfirm, setError, onBoardRefresh: refresh,
    });

    async function saveSetting(key: "enable_wip_limits" | "kanban_backlog_enabled", value: boolean) {
        setSaving(true);
        setError("");
        try {
            const { data: saved } = await updateProjectBoardSettings(project.id, { [key]: value });
            client.setQueryData(queryKey, (previous: any) => previous ? { ...previous, project: saved } : previous);
            await Promise.all([
                client.invalidateQueries({ queryKey: ["tasks", "projects"] }),
                client.invalidateQueries({ queryKey: ["tasks", "myProjects"] }),
            ]);
            refresh();
        } catch (err) {
            setError(writeError(err, "Failed to save board settings"));
        } finally { setSaving(false); }
    }

    async function createTicket(event: React.FormEvent) {
        event.preventDefault();
        if (!title.trim()) return;
        setSaving(true);
        setError("");
        try {
            await addTask({ title: title.trim(), project_id: project.id });
            setTitle("");
            setCreating(false);
            refresh();
        } catch (err) { setError(writeError(err, "Failed to create ticket")); }
        finally { setSaving(false); }
    }

    function move(ticket: any, target: { id: string }) {
        const column = columns.find((candidate) => String(candidate.stateId) === String(target.id) || candidate.key === target.id);
        if (!column) return;
        const decision = boardTargetDecision(ticket, column);
        if (!decision.allowed) { setError(reasonCopy(decision.reason)); return; }
        drag.dropOnColumn(ticket.id, column);
    }

    return <section className={s.surface} aria-label={backlog ? "Project backlog" : "Project board"}>
        <div className={s.toolbar}>
            <div>
                <span className={s.eyebrow}>{backlog ? "READY WHEN YOU ARE" : "CONTINUOUS FLOW"}</span>
                <p className={s.caption}>{backlog ? "Initial-state tickets, ready to pull onto the board." : "All project work. Done shows the last 14 days; Cancelled stays off the board."}</p>
            </div>
            {currentProject.capabilities?.canCreateTickets && <button className="btn btn-primary btn-sm" onClick={() => setCreating((value) => !value)}>New ticket</button>}
        </div>
        {currentProject.capabilities?.canEditWorkflow && <details className={s.settings}>
            <summary>Board settings</summary>
            <div className={s.switches}>
                {currentProject.type === "kanban" && <label><input type="checkbox" aria-label="Kanban backlog" disabled={saving}
                    checked={!!currentProject.kanban_backlog_enabled} onChange={(event) => void saveSetting("kanban_backlog_enabled", event.target.checked)} />
                    <span>Kanban backlog<small>Keep initial-state work off the board until it starts.</small></span></label>}
                <label><input type="checkbox" aria-label="WIP limits" disabled={saving}
                    checked={!!currentProject.enable_wip_limits} onChange={(event) => void saveSetting("enable_wip_limits", event.target.checked)} />
                    <span>WIP limits<small>Stop moves into full columns. Set each limit in project workflow settings.</small></span></label>
            </div>
        </details>}
        {(error || isError) && <div role="alert" className={s.error}>{error || "Failed to load project work."}
            <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}>Retry</button></div>}
        {creating && <form className={s.create} onSubmit={createTicket}>
            <label htmlFor={`board-title-${project.id}`}>Ticket title</label>
            <input id={`board-title-${project.id}`} autoFocus required maxLength={500} value={title} onChange={(event) => setTitle(event.target.value)} />
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>Create ticket</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>Cancel</button>
        </form>}
        {isLoading ? <p role="status">Loading project work…</p> : backlog ? <div className={s.backlog}>
            {!tickets.length && <p className={s.empty}>Nothing waiting. Pull work back to the initial state to keep it here.</p>}
            {planningFamilies(tickets).map(({ task: ticket, subtasks }) => <div key={ticket.id}>
                <div className={s.backlogRow}>
                <TaskCard task={ticket} onOpenDetail={onOpenDetail} onOpenComments={onOpenComments} onStatusChange={move} />
                <label className={s.pull}>Pull onto board
                    <select aria-label={`Move ${ticket.ticket_key ?? ticket.id} to board`} value="" onChange={(event) => move(ticket, { id: event.target.value })}>
                        <option value="">Choose state…</option>
                        {columns.map((column) => {
                            const decision = boardTargetDecision(ticket, column);
                            return <option key={column.stateId} value={column.stateId} disabled={!decision.allowed}>
                                {column.name}{!decision.allowed ? ` — ${reasonCopy(decision.reason)}` : ""}
                            </option>;
                        })}
                    </select>
                </label>
                </div>
                <PlanningSubtasks parent={ticket} subtasks={subtasks} onOpenDetail={onOpenDetail} />
            </div>)}
        </div> : <KanbanBoard tasks={tickets} columns={columns} sprintMode={false} drag={drag} boardDrag={boardDrag}
            announcement={announcement} onOpenDetail={onOpenDetail} onOpenComments={onOpenComments} onStatusChange={move} />}
    </section>;
}
