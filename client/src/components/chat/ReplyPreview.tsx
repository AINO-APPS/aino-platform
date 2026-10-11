import { Paperclip as AttachmentIcon, Mic as VoiceIcon } from "../../constants/icons";
import { X as MaterialX } from "../../constants/icons";
import s from "./ReplyPreview.module.css";

interface ReplyPreviewProps {
    senderName?: string;
    content?: string;
    onClear?: () => void;
    onClick?: () => void;
}

export default function ReplyPreview({ senderName, content, onClear, onClick }: ReplyPreviewProps) {
    return (
        <div className={`${s.bar} ${onClick ? s.clickable : ""}`} onClick={onClick}>
            <div className={s.accent} />
            <div className={s.body}>
                <span className={s.name}>{senderName}</span>
                <span className={s.text}>{content?.slice(0, 100) || <><AttachmentIcon size={14} /> Attachment</>}</span>
            </div>
            {onClear && (
                <button
                    type="button"
                    className={s.close}
                    onClick={(e) => { e.stopPropagation(); onClear(); }}
                    onPointerDown={(e) => e.stopPropagation()}
                >
                    <MaterialX size="14" width="14" height="14" />
                </button>
            )}
        </div>
    );
}