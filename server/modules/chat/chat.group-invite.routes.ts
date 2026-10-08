/**
 * HTTP adapters for group invite links, join requests, the group photo, and
 * the "is a group call running here?" lookup. SQL lives in
 * chat.group-invite.repository.ts; permission rules in utils/groupPerms.
 */
import express from "express";
import type { Request, Response } from "express";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");
const { sendToUser } = require("../../utils/ws");
const multer = require("multer");
const { getUploadKey, getUploadUrl, getKeyFromUrl } = require("../../utils/uploadPath");
const { getStorage, randomFilename } = require("../../platform/storage");
const { canDo, loadGroupContext } = require("../../utils/groupPerms");
import { ChatError } from "./chat.types";
import { parseConversationId, parseUserId } from "./chat.schema";
import { db, type DbLike, emitSystemMessage } from "./chat.shared";
import { createGroupInviteService, isOwnGroupAvatarUrl } from "./chat.group-invite.service";

const router = express.Router();
const invites = createGroupInviteService();

const AVATAR_TYPES: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
};
const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req: Request, file: { mimetype: string }, cb: (err: Error | null, ok?: boolean) => void) => {
        if (AVATAR_TYPES[file.mimetype]) cb(null, true);
        else cb(new ChatError("Only JPEG, PNG or WebP images are allowed"));
    },
});

function fail(req: Request, res: Response, err: unknown, label: string) {
    if (err instanceof ChatError) return res.status(err.statusCode).json({ error: err.message });
    req.log.error({ err }, label);
    return res.status(500).json({ error: label });
}

/** Loads the caller's group context and throws 403 unless `action` is allowed. */
async function requireAction(req: Request, conversationId: number, action: string, message: string) {
    const ctx = await loadGroupContext(req.db as unknown as DbLike, conversationId, req.userId, req.roleLevel || 1);
    if (!ctx || !ctx.isGroup) throw new ChatError("Group not found", 404);
    if (!canDo(action, ctx)) throw new ChatError(message, 403);
    return ctx;
}

async function notifyAdminsOfRequest(req: Request, conversationId: number, userId: number, userName: string | null) {
    const adminIds = await invites.listGroupAdminIds(db(req), conversationId);
    for (const adminId of adminIds) {
        sendToUser(req.tenantId, adminId, "chat_group_join_request", { conversationId, userId, userName });
    }
}

// ── Invite link management (owner/admin) ────────────────────────────────────

router.get("/conversations/:id/invite-link", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const conversationId = parseConversationId(req.params.id);
        await requireAction(req, conversationId, "manage_invite", "Only admins can manage the group link");
        res.json(await invites.getInviteLink(db(req), conversationId));
    } catch (err) {
        fail(req, res, err, "Failed to load group link");
    }
});

router.put("/conversations/:id/invite-link", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const conversationId = parseConversationId(req.params.id);
        await requireAction(req, conversationId, "manage_invite", "Only admins can manage the group link");
        const { enabled, requiresApproval } = req.body ?? {};
        res.json(await invites.updateInviteLink(db(req), conversationId, { enabled, requiresApproval }));
    } catch (err) {
        fail(req, res, err, "Failed to update group link");
    }
});

router.post("/conversations/:id/invite-link/reset", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const conversationId = parseConversationId(req.params.id);
        await requireAction(req, conversationId, "manage_invite", "Only admins can reset the group link");
        res.json(await invites.resetInviteLink(db(req), conversationId));
    } catch (err) {
        fail(req, res, err, "Failed to reset group link");
    }
});

// ── Joining via link (any active user of the tenant) ────────────────────────

router.get("/invite/:token", auth, async (req: Request, res: Response) => {
    try {
        res.json(await invites.previewInvite(db(req), req.userId!, req.params.token));
    } catch (err) {
        fail(req, res, err, "Failed to load invite");
    }
});

router.post("/invite/:token/join", auth, async (req: Request, res: Response) => {
    try {
        const outcome = await invites.joinByInvite(db(req), req.userId!, req.params.token);
        if (outcome.status === "pending") {
            if (outcome.created) await notifyAdminsOfRequest(req, outcome.conversationId, req.userId!, outcome.userName);
            return res.json({ conversationId: outcome.conversationId, pending: true });
        }
        if (outcome.added) {
            sendToUser(req.tenantId, req.userId, "chat_group_added", { conversationId: outcome.conversationId });
            await emitSystemMessage(req.db as unknown as DbLike, req.tenantId, outcome.conversationId, req.userId, {
                type: "member_joined_via_link",
                actorId: req.userId,
                text: `${outcome.userName || "Someone"} joined the group via the group link`,
            });
        }
        res.json({ conversationId: outcome.conversationId, pending: false });
    } catch (err) {
        fail(req, res, err, "Failed to join group");
    }
});

router.delete("/invite/:token/request", auth, async (req: Request, res: Response) => {
    try {
        await invites.cancelJoinRequest(db(req), req.userId!, req.params.token);
        res.json({ ok: true });
    } catch (err) {
        fail(req, res, err, "Failed to cancel request");
    }
});

// ── Join requests (owner/admin) ─────────────────────────────────────────────

router.get("/conversations/:id/join-requests", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const conversationId = parseConversationId(req.params.id);
        await requireAction(req, conversationId, "manage_invite", "Only admins can review requests");
        res.json(await invites.listJoinRequests(db(req), conversationId));
    } catch (err) {
        fail(req, res, err, "Failed to load requests");
    }
});

async function resolveRequest(req: Request, res: Response, approve: boolean) {
    try {
        const conversationId = parseConversationId(req.params.id);
        const userId = parseUserId(req.params.userId);
        await requireAction(req, conversationId, "manage_invite", "Only admins can review requests");
        const result = await invites.resolveJoinRequest(db(req), conversationId, userId, approve);
        if (result.added) {
            const actorName = (await invites.getUserName(db(req), req.userId!)) || "Someone";
            sendToUser(req.tenantId, userId, "chat_group_added", { conversationId });
            await emitSystemMessage(req.db as unknown as DbLike, req.tenantId, conversationId, req.userId, {
                type: "member_added",
                actorId: req.userId,
                targetId: userId,
                text: `${actorName} approved ${result.userName || "a request"} to join`,
            });
        }
        res.json({ ok: true, added: result.added });
    } catch (err) {
        fail(req, res, err, approve ? "Failed to approve request" : "Failed to deny request");
    }
}

router.post("/conversations/:id/join-requests/:userId/approve", auth, loadUserContext, (req: Request, res: Response) =>
    resolveRequest(req, res, true),
);
router.post("/conversations/:id/join-requests/:userId/deny", auth, loadUserContext, (req: Request, res: Response) =>
    resolveRequest(req, res, false),
);

// ── Group photo (set_metadata) ──────────────────────────────────────────────

router.post(
    "/conversations/:id/avatar",
    auth,
    loadUserContext,
    (req: Request, res: Response, next: () => void) => {
        avatarUpload.single("avatar")(req, res, (err: unknown) => {
            if (err) {
                const tooBig = (err as { code?: string }).code === "LIMIT_FILE_SIZE";
                return res.status(400).json({ error: tooBig ? "Image must be 5 MB or smaller" : (err as Error).message });
            }
            next();
        });
    },
    async (req: Request, res: Response) => {
        try {
            const conversationId = parseConversationId(req.params.id);
            await requireAction(req, conversationId, "set_metadata", "Only admins can edit group info");
            if (!req.file) return res.status(400).json({ error: "No image uploaded" });

            const orgId = await invites.getGroupOrgId(db(req), conversationId);
            const filename = randomFilename("group", AVATAR_TYPES[req.file.mimetype]);
            const key = getUploadKey(req.tenantId, orgId, "avatars", filename);
            const avatar = getUploadUrl(req.tenantId, orgId, "avatars", filename);
            // Store before the DB write so the row never points at a missing object.
            try {
                await getStorage().put(key, req.file.buffer, { contentType: req.file.mimetype });
            } catch (err) {
                req.log.error({ err, key }, "Group photo upload to storage failed");
                return res.status(500).json({ error: "Failed to store group photo" });
            }

            const previous = await invites.replaceGroupAvatar(db(req), conversationId, avatar);
            // Only ever delete a group photo we stored for this tenant/org; the old column value is not trusted.
            const oldKey = isOwnGroupAvatarUrl(previous, req.tenantId, orgId) ? getKeyFromUrl(previous) : null;
            if (oldKey) getStorage().delete(oldKey).catch(() => undefined);

            const actorName = (await invites.getUserName(db(req), req.userId!)) || "Someone";
            await emitSystemMessage(req.db as unknown as DbLike, req.tenantId, conversationId, req.userId, {
                type: "group_info_updated",
                actorId: req.userId,
                text: `${actorName} changed the group photo`,
            });
            res.json({ avatar });
        } catch (err) {
            fail(req, res, err, "Failed to update group photo");
        }
    },
);

// ── Active group call (any member) ──────────────────────────────────────────

router.get("/conversations/:id/active-call", auth, async (req: Request, res: Response) => {
    try {
        const conversationId = parseConversationId(req.params.id);
        const call = await invites.getActiveGroupCall(db(req), req.userId!, conversationId);
        if (!call) return res.status(204).end();
        res.json(call);
    } catch (err) {
        fail(req, res, err, "Failed to load group call");
    }
});

export default router;
