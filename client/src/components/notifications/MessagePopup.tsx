import { useEffect, useRef, useState } from "react";
import { X, Send } from "../../constants/icons";
import ConversationAvatar from "../chat/ConversationAvatar";
import type { MessageAlert, MessageAlertAction } from "./messageAlerts";
import s from "./MessagePopup.module.css";

function Card({ card, act }: { card: MessageAlert; act: (action: MessageAlertAction["action"], card: MessageAlert, text?: string) => void }) {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    // Kept here, not round-tripped through IPC, so typing, caret position and IME composition stay native.
    const [draft, setDraft] = useState("");
    const input = useRef<HTMLTextAreaElement>(null);
    useEffect(() => { if (card.replyOpen) input.current?.focus(); else setDraft(""); }, [card.replyOpen]);
    useEffect(() => {
        if (hovered || focused || card.replyOpen || card.busy || card.error || draft) return;
        const timer = setTimeout(() => act("dismiss", card), 10_000);
        return () => clearTimeout(timer);
    }, [card.updatedAt, hovered, focused, card.replyOpen, card.busy, card.error, draft, act]);
    const send = () => { if (!card.busy && draft.trim()) act("reply", card, draft); };
    return (
        <section className={s.card} aria-label={`Message from ${card.title}`}
            onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
            onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
            onKeyDown={(event) => { if (event.key === "Escape" && !card.busy) act("dismiss", card); }}>
            <button className={s.message} disabled={card.busy} onClick={() => act("open", card)} title="Open chat">
                <ConversationAvatar conv={{ id: card.conversationId, is_group: card.isGroup,
                    group_avatar: card.isGroup ? card.avatar : null, other_avatar: card.avatar, group_member_previews: card.members }}
                    name={card.title} size="md" />
                <span className={s.details}>
                    <strong>{card.title}{card.count > 1 && <span className={s.count}> · {card.count}</span>}</strong>
                    <span className={s.preview}>{card.isGroup && card.sender ? `${card.sender}: ` : ""}{card.preview}</span>
                </span>
            </button>
            <button className={s.close} aria-label="Dismiss notification" disabled={card.busy} onClick={() => act("dismiss", card)}><X size={16} /></button>
            {card.replyOpen ? (
                <form className={s.reply} onSubmit={(event) => { event.preventDefault(); send(); }}>
                    <textarea ref={input} aria-label={`Reply to ${card.title}`} placeholder="Reply" maxLength={5000}
                        value={draft} disabled={card.busy} rows={1} onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
                        }} />
                    <button aria-label="Send reply" disabled={card.busy || !draft.trim()} type="submit"><Send size={16} /></button>
                </form>
            ) : (
                <div className={s.actions}>
                    <button disabled={card.busy} onClick={() => act("expand", card)}>Reply</button>
                    <button disabled={card.busy} onClick={() => act("read", card)}>Mark as read</button>
                </div>
            )}
            {card.error && <p className={s.error} role="alert">{card.error}</p>}
        </section>
    );
}

export default function MessagePopup({ cards, act, standalone = false }: {
    cards: MessageAlert[]; standalone?: boolean;
    act: (action: MessageAlertAction["action"], card: MessageAlert, text?: string) => void;
}) {
    return <div data-message-popup className={`${s.stack} ${standalone ? s.standalone : ""}`} aria-live="polite" aria-relevant="additions">
        {cards.slice(0, 3).map((card) => <Card key={card.conversationId} card={card} act={act} />)}
    </div>;
}
