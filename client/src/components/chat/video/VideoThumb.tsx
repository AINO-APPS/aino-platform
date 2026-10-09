import { useState } from "react";
import { createPortal } from "react-dom";
import { Film, Play } from "lucide-react";
import VideoViewer, { type ViewerMeta } from "./VideoViewer";
import { fillTargetDimensions, formatVideoTime, useVideoMeta } from "./useVideoMeta";
import s from "./Video.module.css";

interface Props {
    fileUrl: string;
    fileName?: string;
    withCaption?: boolean;
    viewer?: ViewerMeta;
}

/**
 * In-bubble video tile (Android `ChatThumbnail` + Teams): poster sized like
 * Signal media, frosted play button and a duration pill. Clicking opens the
 * full-screen Teams-style viewer.
 */
export default function VideoThumb({ fileUrl, fileName, withCaption, viewer }: Props) {
    const meta = useVideoMeta(fileUrl);
    const [open, setOpen] = useState(false);
    const box = fillTargetDimensions(meta.width, meta.height, withCaption ? 240 : 150);

    return (
        <>
            <button
                type="button"
                className={s.thumb}
                style={{ width: box.width, height: box.height }}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen(true);
                }}
                aria-label={`Play video${fileName ? ` ${fileName}` : ""}${meta.duration ? `, ${formatVideoTime(meta.duration)}` : ""}`}
                title="Play video"
            >
                {meta.poster ? (
                    <img src={meta.poster} alt="" className={s.thumbImg} draggable={false} />
                ) : (
                    <span className={s.thumbFallback}>
                        <Film size={28} />
                    </span>
                )}
                <span className={s.thumbShade} aria-hidden="true" />
                <span className={s.thumbPlay} aria-hidden="true">
                    <Play size={24} fill="currentColor" />
                </span>
                {meta.duration > 0 && (
                    <span className={s.thumbBadge}>
                        <Play size={10} fill="currentColor" />
                        {formatVideoTime(meta.duration)}
                    </span>
                )}
            </button>
            {open &&
                createPortal(
                    <VideoViewer src={fileUrl} poster={meta.poster} fileName={fileName} meta={viewer} onClose={() => setOpen(false)} />,
                    document.body,
                )}
        </>
    );
}
