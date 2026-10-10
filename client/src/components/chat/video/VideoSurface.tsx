import { useEffect, useRef } from "react";
import { Loader2, Play, RotateCcw } from "lucide-react";
import VideoControls from "./VideoControls";
import { useVideoPlayer } from "./useVideoPlayer";
import s from "./Video.module.css";

interface Props {
    src: string;
    poster?: string | null;
    fileName?: string;
    autoPlay?: boolean;
    compact?: boolean;
    showDownload?: boolean;
    className?: string;
    /** Receives keyboard focus on mount so shortcuts work immediately. */
    autoFocus?: boolean;
}

/** <video> with custom Teams-style controls, a centre play/replay affordance and a buffering spinner. */
export default function VideoSurface({ src, poster, fileName, autoPlay, compact, showDownload = true, className, autoFocus }: Props) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const api = useVideoPlayer(videoRef, wrapRef, src);
    const { state } = api;
    const { play } = api;

    useEffect(() => {
        if (autoPlay) void play();
    }, [autoPlay, src, play]);

    useEffect(() => {
        if (autoFocus) wrapRef.current?.focus();
    }, [autoFocus]);

    return (
        <div
            ref={wrapRef}
            className={`${s.surface} ${state.controlsVisible ? "" : s.hideCursor} ${className || ""}`}
            tabIndex={0}
            onMouseMove={api.poke}
            onKeyDown={(e) => {
                if (api.handleKey(e)) e.stopPropagation();
            }}
            onClick={(e) => {
                e.stopPropagation();
                api.toggle();
            }}
            onDoubleClick={(e) => {
                e.stopPropagation();
                api.toggleFullscreen();
            }}
            aria-label={fileName || "Video player"}
            role="region"
        >
            <video
                ref={videoRef}
                src={src}
                poster={poster || undefined}
                className={s.video}
                playsInline
                preload="metadata"
            />
            {state.error && (
                <div className={s.playbackError} role="alert" onClick={(e) => e.stopPropagation()}>
                    <span>{state.error}</span>
                    <button type="button" onClick={() => void api.play()}>Try again</button>
                </div>
            )}
            {state.waiting && !state.error && (
                <div className={s.centre} aria-hidden="true">
                    <Loader2 size={36} className={s.spin} />
                </div>
            )}
            {!state.playing && !state.waiting && !state.error && (
                <div className={s.centre}>
                    <span className={s.bigPlay} aria-hidden="true">
                        {state.ended ? <RotateCcw size={28} /> : <Play size={30} fill="currentColor" />}
                    </span>
                </div>
            )}
            <VideoControls api={api} downloadUrl={showDownload ? src : undefined} fileName={fileName} compact={compact} />
        </div>
    );
}
