import { useEffect } from "react";
import { X, Download, Forward, MessageSquareText } from "lucide-react";
import ChatAvatar from "../ChatAvatar";
import VideoSurface from "./VideoSurface";
import s from "./Video.module.css";

export interface ViewerMeta {
    senderName?: string | null;
    senderAvatar?: string | null;
    sentAt?: string | null;
    onForward?: () => void;
    onGoToMessage?: () => void;
}

interface Props {
    src: string;
    poster?: string | null;
    fileName?: string;
    meta?: ViewerMeta;
    onClose: () => void;
}

function fmtSent(ts?: string | null) {
    if (!ts) return "";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Teams-style full-screen media viewer: sender header + actions, centred video with custom controls. */
export default function VideoViewer({ src, poster, fileName, meta, onClose }: Props) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !document.fullscreenElement) onClose();
        };
        document.addEventListener("keydown", onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.removeEventListener("keydown", onKey);
            document.body.style.overflow = prev;
        };
    }, [onClose]);

    const run = (fn?: () => void) => () => {
        onClose();
        fn?.();
    };

    return (
        <div className={s.viewer} role="dialog" aria-modal="true" aria-label={fileName || "Video"} onClick={onClose}>
            <header className={s.viewerTop} onClick={(e) => e.stopPropagation()}>
                <div className={s.viewerWho}>
                    {meta?.senderName && <ChatAvatar name={meta.senderName} avatar={meta.senderAvatar} size="md" />}
                    <div className={s.viewerWhoText}>
                        <span className={s.viewerName}>{meta?.senderName || fileName || "Video"}</span>
                        <span className={s.viewerSub}>{[fmtSent(meta?.sentAt), meta?.senderName ? fileName : ""].filter(Boolean).join(" · ")}</span>
                    </div>
                </div>
                <div className={s.viewerActions}>
                    {meta?.onGoToMessage && (
                        <button type="button" className={s.viewerBtn} onClick={run(meta.onGoToMessage)} title="Go to message" aria-label="Go to message">
                            <MessageSquareText size={19} />
                        </button>
                    )}
                    {meta?.onForward && (
                        <button type="button" className={s.viewerBtn} onClick={run(meta.onForward)} title="Forward" aria-label="Forward">
                            <Forward size={19} />
                        </button>
                    )}
                    <a className={s.viewerBtn} href={src} download={fileName || true} title="Download" aria-label="Download">
                        <Download size={19} />
                    </a>
                    <span className={s.viewerSep} />
                    <button type="button" className={s.viewerBtn} onClick={onClose} title="Close (Esc)" aria-label="Close">
                        <X size={21} />
                    </button>
                </div>
            </header>
            <div className={s.viewerStage}>
                <VideoSurface src={src} poster={poster} fileName={fileName} autoPlay autoFocus className={s.viewerSurface} showDownload={false} />
            </div>
        </div>
    );
}
