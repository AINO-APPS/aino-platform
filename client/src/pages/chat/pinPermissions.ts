type PinnedMsg = { pinned_at?: unknown; pinned_by?: unknown };

export interface PinContext {
    userId?: number | string | null;
    isGroup: boolean;
    /** The current user's role in the group (owner/admin/member). */
    myRole?: string | null;
}

/**
 * Client mirror of the server unpin rule (chat.service togglePin): the pinner,
 * or a group owner/admin. Legacy 1:1 pins without pinned_by stay unpinnable.
 * The server remains authoritative (org governance may still unpin).
 */
export function canUnpinMessage(msg: PinnedMsg, ctx: PinContext): boolean {
    if (msg.pinned_by != null && ctx.userId != null && String(msg.pinned_by) === String(ctx.userId)) return true;
    if (ctx.isGroup) return ctx.myRole === "owner" || ctx.myRole === "admin";
    return msg.pinned_by == null;
}

/** Pinning is open to every participant; only unpinning is restricted. */
export function canTogglePin(msg: PinnedMsg, ctx: PinContext): boolean {
    return !msg.pinned_at || canUnpinMessage(msg, ctx);
}

export function pinErrorMessage(err: unknown): string {
    const data = (err as { response?: { data?: { error?: unknown } } })?.response?.data;
    return typeof data?.error === "string" && data.error ? data.error : "Couldn't update the pin. Please try again.";
}
