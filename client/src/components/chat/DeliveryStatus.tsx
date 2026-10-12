import { useId } from "react";
import { AlertCircle } from "../../constants/icons";
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

// Exact Android `SignalReceiptIcon` geometry (16-unit grid, drawn at 15px); also used by list receipts.
export type TickState = "sent" | "delivered" | "read";

const OUTER_CHECK = "M4.9 8.2L7 10.3L11.1 5.8";
const INNER_CHECK = "M5.6 8.1L7.2 9.7L10.4 6.3";
const stroke = { strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } as const;

export function RippleTickGlyph({ state, size = 15 }: { state: TickState; size?: number }) {
    // Delivered punches the check out of the disc (true transparency, like Android over any bubble).
    const maskId = `tick-punch-${useId().replace(/:/g, "")}`;
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" data-tick={state}>
            {state === "sent" && (
                <>
                    <circle cx="8" cy="8" r="6.6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                    <path d={OUTER_CHECK} stroke="currentColor" strokeWidth="1.5" {...stroke} />
                </>
            )}
            {state === "delivered" && (
                <>
                    <mask id={maskId}>
                        <rect width="16" height="16" fill="#fff" />
                        <path d={OUTER_CHECK} stroke="#000" strokeWidth="1.5" {...stroke} />
                    </mask>
                    <circle cx="8" cy="8" r="7" fill="currentColor" mask={`url(#${maskId})`} />
                </>
            )}
            {state === "read" && (
                <>
                    <circle cx="8" cy="8" r="7.2" stroke="currentColor" strokeWidth="1.3" strokeOpacity="0.45" fill="none" />
                    <circle cx="8" cy="8" r="5.2" fill="currentColor" />
                    <path d={INNER_CHECK} stroke="var(--tick-read-check, #fff)" strokeWidth="1.4" {...stroke} />
                </>
            )}
        </svg>
    );
}

function SendingTick() {
    return (
        <span className={`${s.tick} ${s.tickSending}`} title="Sending…" aria-label="Sending">
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.35" fill="none" />
                <path d="M8 2A6 6 0 0 1 14 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
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