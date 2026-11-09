// Notes exposes endpoint-specific ticket summaries, all enriched by the shared
// ticket capability pipeline before their response fields are selected.
import type { Request } from "express";
const { enrichTaskSummaries } = require("../../tasks/_helpers/enrich");
const { taskActorFromRequest, taskActorFromUser } = require("../../../modules/tasks/tasks.policy");
const { searchTasksForLinking } = require("../../../modules/tasks/tasks.notes");
const { isFeatureEnabled } = require("../../../utils/planCatalog");

async function linkedTickets(links: any[], ticketsById: Map<number, any>, req: Request): Promise<any[]> {
    const tickets = await enrichTaskSummaries(
        [...ticketsById.values()],
        req.db,
        taskActorFromRequest(req),
    );
    const ticketById = new Map(tickets.map((ticket: any) => [Number(ticket.id), {
        id: ticket.id,
        title: ticket.title,
        start_date: ticket.start_date,
        planned_date: ticket.planned_date,
        status: ticket.status,
        priority: ticket.priority,
        date: ticket.date,
        due_date: ticket.due_date,
        sprint_id: ticket.sprint_id,
        container: ticket.container,
        capabilities: ticket.capabilities,
    }]));
    return links.map((link) => link.entity_type === "task"
        ? { ...link, detail: ticketById.get(Number(link.entity_id)) ?? null }
        : link);
}

async function dailyTasks(tasks: any[], req: Request): Promise<any[]> {
    return (await enrichTaskSummaries(tasks, req.db, taskActorFromRequest(req))).map((task: any) => ({
        id: task.id,
        title: task.title,
        start_date: task.start_date,
        planned_date: task.planned_date,
        status: task.status,
        priority: task.priority,
        container: task.container,
        capabilities: task.capabilities,
    }));
}

async function oneOnOneTasks(tasks: any[], req: Request): Promise<any[]> {
    return (await enrichTaskSummaries(tasks, req.db, taskActorFromRequest(req))).map((task: any) => ({
        id: task.id,
        title: task.title,
        start_date: task.start_date,
        planned_date: task.planned_date,
        status: task.status,
        priority: task.priority,
        date: task.date,
        completed_at: task.completed_at,
        container: task.container,
        capabilities: task.capabilities,
    }));
}

async function convertedTask(placed: any, req: Request): Promise<any> {
    const enriched = await enrichTaskSummaries([placed], req.db, taskActorFromRequest(req));
    return {
        id: placed.id,
        title: placed.title,
        start_date: enriched[0].start_date,
        planned_date: enriched[0].planned_date,
        date: placed.start_date ?? null,
        priority: placed.priority,
        sprint_id: placed.sprint_id ?? null,
        container: enriched[0].container,
        capabilities: enriched[0].capabilities,
    };
}

async function sprintEmbed(sprint: any, tasks: any[], req: Request): Promise<any> {
    // Stats bucket by workflow-state category (D6) rather than by key: the
    // key is org-configurable, so matching on it silently reported zero
    // once the legacy `tasks.status` column was dropped.
    const total = tasks.length;
    const bucket = (category: string) =>
        tasks.filter((t: { status_category: string | null }) => t.status_category === category).length;
    const done = bucket("done");
    const inProgress = bucket("in_progress");
    const inReview = bucket("in_review");
    const pending = bucket("open");

    return {
        sprint,
        tasks: (await enrichTaskSummaries(tasks, req.db, taskActorFromRequest(req))).map((task: any) => ({
            id: task.id,
            title: task.title,
        start_date: task.start_date,
        planned_date: task.planned_date,
            status: task.status,
            status_category: task.status_category,
            priority: task.priority,
            assigned_to: task.assigned_to,
            assignee_name: task.assignee_name,
            container: task.container,
            capabilities: task.capabilities,
        })),
        stats: { total, done, inProgress, inReview, pending },
    };
}

async function searchTasks(userRow: any, q: string | undefined, req: Request): Promise<any[]> {
    const actor = taskActorFromUser(
        userRow,
        isFeatureEnabled((req as any).tenant ?? null, "team_visibility"),
        req.db,
        (req as any).projectOwnership === true,
    );
    const rows = await searchTasksForLinking(req.db!, actor, q);
    const tasks = await enrichTaskSummaries(rows, req.db, actor);
    return tasks.map((task: any) => ({
        id: task.id,
        title: task.title,
        start_date: task.start_date,
        planned_date: task.planned_date,
        status: task.status,
        priority: task.priority,
        date: task.date,
        container: task.container,
        capabilities: task.capabilities,
    }));
}

export = { linkedTickets, dailyTasks, oneOnOneTasks, convertedTask, sprintEmbed, searchTasks };
