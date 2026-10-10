import s from "./MessageBubble.module.css";

interface ChatMsg {
    id: number | string;
    created_at: string;
    delivered_to?: (number | string)[];
    [key: string]: unknown;
}

interface DeliveryStatusProps {
    isMine: boolean;
    msg: ChatMsg;
    participantCount?: number;
    readReceipts?: Record<string, string>;
    userId: number | string;
}

/* ───────────────────────────────────────────────────────────────────────────
 * "Ripple tick" delivery glyphs (SVG) — the ring fills in as the message travels
 *
 *   sending   → an animated spinning ring (message not yet confirmed)
 *   sent      → outlined circle with a check
 *   delivered → solid disc with the check punched out
 *   read      → org-accent (--primary) disc with a ripple ring around it
 * ─────────────────────────────────────────────────────────────────────────── */

export type TickState = "sent" | "delivered" | "read";

export function RippleTickGlyph({ state, size = 15 }: { state: TickState; size?: number }) {
    const outerCheck = "M4.9 8.2l2.1 2.1 4.1-4.5";
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
            {state === "sent" && (
                <>
                    <circle cx="8" cy="8" r="6.6" stroke="currentColor" strokeWidth="1.5" />
                    <path d={outerCheck} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </>
            )}
            {state === "delivered" && (
                <>
                    <circle cx="8" cy="8" r="7" fill="currentColor" />
                    {/* Check punched out in the surface colour so it reads in light and dark themes */}
                    <path d={outerCheck} stroke="var(--read-check-bg, var(--bg, #fff))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </>
            )}
            {state === "read" && (
                <>
                    <circle className={s.tickRipple} cx="8" cy="8" r="7.2" stroke="currentColor" strokeWidth="1.3" opacity="0.45" />
                    <circle cx="8" cy="8" r="5.2" fill="currentColor" />
                    <path d="M5.6 8.1l1.6 1.6 3.2-3.4" stroke="var(--read-check-bg, #fff)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </>
            )}
        </svg>
    );
}

function SendingTick() {
    return (
        <span className={`${s.tick} ${s.tickSending}`} title="Sending…" aria-label="Sending">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
                <path d="M8 2a6 6 0 016 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        </span>
    );
}

function SentTick() {
    return (
        <span className={`${s.tick} ${s.tickSent}`} title="Sent" aria-label="Sent">
            <RippleTickGlyph state="sent" />
        </span>
    );
}

function DeliveredTick() {
    return (
        <span className={`${s.tick} ${s.tickDelivered}`} title="Delivered" aria-label="Delivered">
            <RippleTickGlyph state="delivered" />
        </span>
    );
}

function ReadTick() {
    return (
        <span className={`${s.tick} ${s.tickRead}`} title="Read" aria-label="Read">
            <RippleTickGlyph state="read" />
        </span>
    );
}

export default function DeliveryStatus({ isMine, msg, participantCount, readReceipts, userId }: DeliveryStatusProps) {
    if (!isMine) return null;

    if (msg._failed) {
        return <span className={s.deliveryFailed} title={String(msg._failureReason || "Failed to send")}>!</span>;
    }

    // Pending message — not yet confirmed by server
    if (String(msg.id).startsWith("pending_")) {
        return <SendingTick />;
    }

    const delivered = msg.delivered_to || [];
    const others = (participantCount || 2) - 1;
    if (others <= 0) return null;

    const msgTime = new Date(msg.created_at).getTime();
    const receipts = readReceipts || {};
    const otherReaders = Object.entries(receipts).filter(
        ([uid, readAt]) => Number(uid) !== userId && new Date(readAt).getTime() >= msgTime,
    );

    // Read by everyone (or read + delivered to all) → double-circle filled check
    if (otherReaders.length >= others) {
        return <ReadTick />;
    }
    if (otherReaders.length > 0 && delivered.length >= others) {
        return <ReadTick />;
    }
    // Delivered to all / some → check inside a circle
    if (delivered.length >= others) {
        return <DeliveredTick />;
    }
    if (delivered.length > 0) {
        return <DeliveredTick />;
    }
    // Sent only → single check
    return <SentTick />;
}