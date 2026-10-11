import { CheckCircle2, CheckDone, Verified, Loader2, AlertCircle } from "../../constants/icons";
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

// The shared delivery glyph API is also used by conversation-list receipts.

export type TickState = "sent" | "delivered" | "read";

export function RippleTickGlyph({ state, size = 15 }: { state: TickState; size?: number }) {
    const Icon = state === "sent" ? CheckCircle2 : state === "delivered" ? CheckDone : Verified;
    return <Icon size={size} aria-hidden="true" />;
}

function SendingTick() {
    return (
        <span className={`${s.tick} ${s.tickSending}`} title="Sending…" aria-label="Sending">
            <Loader2 size={14} />
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
        return <span className={s.deliveryFailed} title={String(msg._failureReason || "Failed to send")} aria-label="Failed to send"><AlertCircle size={14} /></span>;
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