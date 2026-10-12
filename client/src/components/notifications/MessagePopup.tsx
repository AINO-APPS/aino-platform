import { useEffect, useRef, useState } from "react";
import { X, MessageSquare, Check, BellOff, Send } from "../../constants/icons";
import ConversationAvatar from "../chat/ConversationAvatar";
import type { MessageAlert, MessageAlertAction } from "./messageAlerts";
import s from "./MessagePopup.module.css";

function Card({ card, act }: { card: MessageAlert; act: (action: MessageAlertAction["action"], card: MessageAlert, text?: string, duration?: "1h" | "always") => void }) {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [duration, setDuration] = useState<"1h" | "always">("1h");
    // Kept here, not round-tripped through IPC, so typing, caret position and IME composition stay native.
    const [draft, setDraft] = useState("");
    const input = useRef<HTMLTextAreaElement>(null);
    useEffect(() => { if (card.replyOpen) input.current?.focus(); else setDraft(""); }, [card.replyOpen]);
    useEffect(() => {
        if (hovered || focused || card.replyOpen || card.busy || card.error || draft) return;
        const timer = setTimeout(() => act("dismiss", card), 10_000);
        return () => clearTimeout(timer);
    }, [card.updatedAt, hovered, focused, card.replyOpen, card.busy, card.error, draft, act]);
    return (
        <section className={s.card} aria-label={`Message notification: ${card.title}`}
            onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
            onKeyDown={(event) => { if (event.key === "Escape" && !card.busy) act("dismiss", card); }}>
            <div className={s.heading}>
                <span className={s.app}>AINO <span className={s.dot} /> Messages</span>
                <button className={s.iconButton} aria-label="Dismiss notification" disabled={card.busy} onClick={() => act("dismiss", card)}><X size={16} /></button>
            </div>
            <button className={s.message} disabled={card.busy} onClick={() => act("open", card)}>
                <ConversationAvatar conv={{ id: card.conversationId, is_group: card.isGroup,
                    group_avatar: card.isGroup ? card.avatar : null, other_avatar: card.avatar, group_member_previews: card.members }}
                    name={card.title} size="lg" />
                <span className={s.details}>
                    <strong>{card.title}</strong>
                    {card.isGroup && card.sender && <span className={s.sender}>{card.sender}</span>}
                    <span className={s.preview}>{card.preview}</span>
                    {card.count > 1 && <span className={s.count}>{card.count} new messages</span>}
                </span>
            </button>
            <div className={s.actions}>
                <button disabled={card.busy} onClick={() => act("expand", card)}><MessageSquare size={14} /> Reply</button>
                <button disabled={card.busy} onClick={() => act("read", card)}><Check size={14} /> Mark read</button>
                <select aria-label="Mute duration" value={duration} onChange={(event) => setDuration(event.target.value === "always" ? "always" : "1h")}>
                    <option value="1h">1 hour</option><option value="always">Always</option>
                </select>
                <button disabled={card.busy} aria-label={`Mute conversation ${duration === "1h" ? "for 1 hour" : "always"}`}
                    onClick={() => act("mute", card, undefined, duration)}><BellOff size={14} /></button>
            </div>
            {card.replyOpen && (
                <form className={s.reply} onSubmit={(event) => { event.preventDefault(); act("reply", card, draft); }}>
                    <textarea ref={input} aria-label={`Reply to ${card.title}`} placeholder="Write a reply..." maxLength={5000}
                        value={draft} disabled={card.busy} rows={2} onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                                event.preventDefault();
                                if (!card.busy && draft.trim()) act("reply", card, draft);
                            }
                        }} />
                    <button aria-label="Send reply" disabled={card.busy || !draft.trim()} type="submit"><Send size={16} /> {card.busy ? "Sending..." : "Send"}</button>
                </form>
            )}
            {card.error && <p className={s.error} role="alert">{card.error}</p>}
        </section>
    );
}

export default function MessagePopup({ cards, act, standalone = false }: {
    cards: MessageAlert[]; standalone?: boolean;
    act: (action: MessageAlertAction["action"], card: MessageAlert, text?: string, duration?: "1h" | "always") => void;
}) {
    return <div data-message-popup className={`${s.stack} ${standalone ? s.standalone : ""}`} aria-live="polite" aria-relevant="additions">
        {cards.slice(0, 3).map((card) => <Card key={card.conversationId} card={card} act={act} />)}
    </div>;
}
