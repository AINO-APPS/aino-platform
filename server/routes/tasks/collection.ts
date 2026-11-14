import express from "express";
import { buildTaskCollection, readTaskCollection } from "../../modules/tasks/tasks.collection";
import { resolveTicketDates } from "../../modules/tasks/tasks.dates";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");
const { getLocalToday } = require("../../utils/timezone");
const { ACCESS_DENIED } = require("./_helpers/access");
const { resolveTaskVisibilityForRequest, taskActorFromRequest } = require("../../modules/tasks/tasks.policy");
const { enrichTasks } = require("./_helpers/enrich");

const router = express.Router();
router.get("/", auth, loadUserContext, async (req, res) => {
    try {
        const { date, start_date, end_date, sprint_id, scope, include_due, assignee, label, priority, status, search, project_id } = req.query as Record<string, string>;
        const projectView = scope === "list" || scope === "calendar";
        if (["schedule", "scheduled"].includes(String(scope ?? "")) || req.query.team_id != null || req.query.unassigned != null) {
            res.status(400).json({ error: "Legacy team and schedule scopes are no longer supported" });
            return;
        }
        const offset = Number(req.query.offset ?? 0);
        if (projectView) {
            if (!/^[1-9]\d*$/.test(project_id ?? "") || sprint_id || !Number.isSafeInteger(offset) || offset < 0) {
                res.status(400).json({ error: "A project_id, valid offset and no sprint_id are required for project views" });
                return;
            }
            const dates = [date, start_date, end_date, req.query.start_on, req.query.due_on];
            if (dates.some(value => value !== undefined && resolveTicketDates({}, { start_date: value }).error)
                || (start_date && end_date && start_date > end_date)
                || (scope === "calendar" && req.query.undated !== "1" && !date && !(start_date && end_date))) {
                res.status(400).json({ error: "A valid inclusive date or date range is required" });
                return;
            }
        }
        const actor = taskActorFromRequest(req);
        const visibility = await resolveTaskVisibilityForRequest(actor, {
            scope,
            projectId: project_id ? Number.parseInt(project_id, 10) : null,
        });
        if (projectView && visibility.kind === "project-scope" && !visibility.accessible) {
            res.status(403).json({ error: ACCESS_DENIED });
            return;
        }
        const collection = buildTaskCollection({
            scope: projectView ? scope : "daily", orgId: req.userOrgId || null, visibility,
            sprintId: sprint_id ? parseInt(sprint_id, 10) : undefined, startDate: start_date, endDate: end_date,
            date: date || (projectView || sprint_id || (start_date && end_date) ? undefined : getLocalToday(req)),
            undated: req.query.undated === "1", sort: String(req.query.sort ?? ""), direction: String(req.query.direction ?? ""),
            filters: {
                assignee, label, priority, status, search, projectId: project_id, includeDue: include_due === "1",
                workItemTypeId: req.query.work_item_type_id as string, key: req.query.key as string, title: req.query.title as string,
                startOn: req.query.start_on as string,
                dueOn: req.query.due_on as string,
            },
        });
        const rows = await readTaskCollection(req.db!, collection, projectView ? offset : 0, projectView);
        const tasks = await enrichTasks(rows.slice(0, 500), req.db, actor);
        const total = tasks.length;
        const done = tasks.filter((t: any) => t.workflow_state_category === "done").length;
        const inProgress = tasks.filter((t: any) => t.workflow_state_category === "in_progress").length;
        res.json({
            tasks, stats: { total, done, inProgress, percent: total > 0 ? Math.round((done / total) * 100) : 0 },
            ...(projectView ? { pagination: { offset, hasMore: rows.length > 500 } } : {}),
        });
    } catch (err) {
        req.log.error({ err }, "Error fetching tasks:");
        res.status(500).json({ error: "Failed to fetch tasks" });
    }
});
export = router;
