import { Smile as MaterialSmile } from "../../constants/icons";
import s from "./ReactionPicker.module.css";
import React, { useRef, useEffect } from "react";

const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "👏", "🎉", "👎", "💯"];

interface ReactionPickerProps {
    onSelect: (emoji: string) => void;
    onClose: () => void;
    onOpenFull?: () => void;
    style?: React.CSSProperties;
}

export default function ReactionPicker({ onSelect, onClose, onOpenFull, style }: ReactionPickerProps) {
    const ref = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const handler = (e: PointerEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        // Defer listener so the tap/click that opened the picker doesn't immediately close it
        const timerId = setTimeout(() => {
            document.addEventListener("pointerdown", handler);
        }, 80);
        return () => {
            clearTimeout(timerId);
            document.removeEventListener("pointerdown", handler);
        };
    }, [onClose]);

    return (
        <div ref={ref} className={s.picker} style={style}>
            <div className={s.emojiRow}>
                {EMOJIS.map(e => (
                    <button key={e} className={s.emoji} onClick={() => { onSelect(e); onClose(); }}>
                        {e}
                    </button>
                ))}
            </div>
            {onOpenFull && (
                <button className={s.openFull} onClick={() => { onClose(); onOpenFull(); }} title="Browse all emoji">
                    <MaterialSmile size="14" width="14" height="14" />
                    <span>All Emoji</span>
                </button>
            )}
        </div>
    );
}