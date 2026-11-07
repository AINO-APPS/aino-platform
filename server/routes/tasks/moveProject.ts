import express from "express";
import { moveTicketProject, previewProjectMove } from "../../modules/tasks/tasks.placement";
import { placementContext, PlacementRefused, sendPlacementRefusal } from "./_helpers/placement";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");
const { taskActorFromRequest } = require("../../modules/tasks/tasks.policy");
const { enrichTasks } = require("./_helpers/enrich");

const router = express.Router();

for (const preview of [true, false]) {
    router.post(`/:id/move-project${preview ? "/preview" : ""}`, auth, loadUserContext, async (req, res) => {
        try {
            const id = Number(req.params.id);
            const requestedProject = req.body?.project_id;
            const projectId = typeof requestedProject === "number" || typeof requestedProject === "string"
                ? Number(requestedProject) : NaN;
            if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(projectId) || projectId < 1) {
                res.status(400).json({ error: "Valid task ID and project_id are required" });
                return;
            }
            const actor = taskActorFromRequest(req);
            const result = await req.db!.transaction!(async (client, { afterCommit }) => {
                const context = { ...placementContext(req, client, afterCommit), ticketActor: actor };
                const outcome = preview ? await previewProjectMove(context, id, projectId)
                    : await moveTicketProject(context, id, projectId);
                if (!outcome.ok) throw new PlacementRefused(outcome);
                return outcome;
            });
            if ("preview" in result) res.json(result.preview);
            else res.json({ task: (await enrichTasks([result.task], req.db, actor))[0], moved: true, cleared_sprint: result.clearedSprint });
        } catch (error) {
            if (sendPlacementRefusal(res, error)) return;
            req.log.error({ err: error }, "Error moving ticket to project");
            res.status(500).json({ error: "Failed to move ticket to project" });
        }
    });
}

export = router;
