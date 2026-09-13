import express from "express";
import type { Request, Response } from "express";
import {
    createPlatformAnnouncement, deletePlatformAnnouncement,
    listPlatformAnnouncements, updatePlatformAnnouncement,
} from "../services/platformAnnouncements";
const { logPlatformAction } = require("../utils/platformAudit");
const { logger } = require("../utils/logger");

const router = express.Router();

router.get("/", async (_req: Request, res: Response) => {
    try {
        res.json({ data: await listPlatformAnnouncements() });
    } catch (err) {
        logger.error({ err }, "List platform announcements error");
        res.status(500).json({ error: "Failed to fetch announcements" });
    }
});

router.post("/", async (req: Request, res: Response) => {
    try {
        const announcement = await createPlatformAnnouncement(req.userId!, req.body);
        logPlatformAction(req, "create_announcement", "platform_announcement", announcement.id, { type: announcement.type });
        res.status(201).json({ data: announcement });
    } catch (err: any) {
        if (err?.message === "MESSAGE_REQUIRED") return res.status(400).json({ error: "Message is required" });
        logger.error({ err }, "Create platform announcement error");
        res.status(500).json({ error: "Failed to create announcement" });
    }
});

router.put("/:id", async (req: Request, res: Response) => {
    try {
        const announcement = await updatePlatformAnnouncement(Number(req.params.id), req.body);
        if (!announcement) return res.status(404).json({ error: "Announcement not found" });
        logPlatformAction(req, "update_announcement", "platform_announcement", announcement.id);
        res.json({ data: announcement });
    } catch (err: any) {
        if (err?.message === "MESSAGE_REQUIRED") return res.status(400).json({ error: "Message cannot be empty" });
        if (err?.message === "INVALID_TYPE") return res.status(400).json({ error: "Invalid announcement type" });
        if (err?.message === "NO_FIELDS") return res.status(400).json({ error: "No fields to update" });
        logger.error({ err }, "Update platform announcement error");
        res.status(500).json({ error: "Failed to update announcement" });
    }
});

router.delete("/:id", async (req: Request, res: Response) => {
    try {
        if (!(await deletePlatformAnnouncement(Number(req.params.id)))) {
            return res.status(404).json({ error: "Announcement not found" });
        }
        logPlatformAction(req, "delete_announcement", "platform_announcement", Number(req.params.id));
        res.json({ ok: true });
    } catch (err) {
        logger.error({ err }, "Delete platform announcement error");
        res.status(500).json({ error: "Failed to delete announcement" });
    }
});

export = router;