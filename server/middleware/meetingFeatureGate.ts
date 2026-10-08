import type { NextFunction, Request, Response } from "express";
const { requireFeature } = require("./tenant");

/**
 * Plan gate for `/api/meetings` (product decision 2026-10-07).
 *
 * `calls` (Pro) covers 1:1 calls and instant group calls (huddles);
 * `meetings` (Enterprise) covers scheduled meetings, the lobby and HLS.
 * Huddles reuse the meetings router as their transport, so creating a huddle
 * or reading the huddle being joined is checked against `calls`; every other
 * meetings operation needs `meetings`.
 */
const requireMeetings = requireFeature("meetings");
const requireCalls = requireFeature("calls");

const HUDDLE_LOOKUP = "SELECT is_huddle FROM meetings WHERE meeting_code = $1";

async function isHuddleRequest(req: Request): Promise<boolean> {
    const body = (req.body || {}) as { huddle?: unknown; conversation_id?: unknown };
    if (req.method === "POST" && req.path === "/") {
        return body.huddle === true && body.conversation_id != null && body.conversation_id !== "";
    }
    if (req.method !== "GET") return false;
    const match = /^\/([^/]+)(?:\/messages)?\/?$/.exec(req.path);
    if (!match || match[1] === "check-conflicts") return false;
    const row = (await req.db!.query(HUDDLE_LOOKUP, [decodeURIComponent(match[1])])).rows[0];
    return row?.is_huddle === true;
}

export async function meetingFeatureGate(req: Request, res: Response, next: NextFunction) {
    let huddle = false;
    try {
        huddle = await isHuddleRequest(req);
    } catch (err) {
        req.log.error({ err }, "Meeting feature gate error");
        return res.status(500).json({ error: "Failed to check plan features" });
    }
    return huddle ? requireCalls(req, res, next) : requireMeetings(req, res, next);
}
