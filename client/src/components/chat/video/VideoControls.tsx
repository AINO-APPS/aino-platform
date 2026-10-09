import { useRef, useState } from "react";
import {
    Play,
    Pause,
    Volume2,
    Volume1,
    VolumeX,
    Maximize,
    Minimize,
    PictureInPicture2,
    Download,
    RotateCcw,
    RotateCw,
    Gauge,
} from "lucide-react";
import { formatVideoTime } from "./useVideoMeta";
import { PLAYBACK_SPEEDS, type VideoPlayerApi } from "./useVideoPlayer";
import s from "./Video.module.css";

interface Props {
    api: VideoPlayerApi;
    downloadUrl?: string;
    fileName?: string;
    compact?: boolean;
}

/** Teams-style control bar: seek track with buffer + hover time, then play · skip · volume · time … speed · PiP · download · fullscreen. */
export default function VideoControls({ api, downloadUrl, fileName, compact }: Props) {
    const { state } = api;
    const trackRef = useRef<HTMLDivElement | null>(null);
    const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
    const [speedOpen, setSpeedOpen] = useState(false);
    const dragging = useRef(false);

    const ratioAt = (clientX: number) => {
        const r = trackRef.current?.getBoundingClientRect();
        if (!r || !r.width) return 0;
        return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    };
    const pct = (n: number) => (state.duration ? `${Math.min(100, (n / state.duration) * 100)}%` : "0%");
    const VolIcon = state.muted || state.volume === 0 ? VolumeX : state.volume < 0.5 ? Volume1 : Volume2;

    return (
        <div
            className={`${s.controls} ${state.controlsVisible ? "" : s.controlsHidden} ${compact ? s.compact : ""}`}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
        >
            <div
                ref={trackRef}
                className={s.track}
                role="slider"
                aria-label="Seek"
                aria-valuemin={0}
                aria-valuemax={Math.round(state.duration)}
                aria-valuenow={Math.round(state.current)}
                aria-valuetext={`${formatVideoTime(state.current)} of ${formatVideoTime(state.duration)}`}
                tabIndex={0}
                onKeyDown={(e) => api.handleKey(e)}
                onPointerDown={(e) => {
                    dragging.current = true;
                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                    api.seekTo(ratioAt(e.clientX) * state.duration);
                }}
                onPointerMove={(e) => {
                    const ratio = ratioAt(e.clientX);
                    const r = trackRef.current?.getBoundingClientRect();
                    setHover({ x: r ? e.clientX - r.left : 0, t: ratio * state.duration });
                    if (dragging.current) api.seekTo(ratio * state.duration);
                }}
                onPointerUp={() => (dragging.current = false)}
                onPointerLeave={() => setHover(null)}
            >
                <div className={s.trackRail}>
                    <div className={s.trackBuffered} style={{ width: pct(state.buffered) }} />
                    <div className={s.trackFill} style={{ width: pct(state.current) }} />
                </div>
                <div className={s.trackThumb} style={{ left: pct(state.current) }} />
                {hover && state.duration > 0 && (
                    <div className={s.trackTip} style={{ left: hover.x }}>
                        {formatVideoTime(hover.t)}
                    </div>
                )}
            </div>
            <div className={s.bar}>
                <button type="button" className={s.ctl} onClick={api.toggle} aria-label={state.playing ? "Pause (K)" : "Play (K)"} title={state.playing ? "Pause (K)" : "Play (K)"}>
                    {state.playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                </button>
                {!compact && (
                    <>
                        <button type="button" className={s.ctl} onClick={() => api.skip(-10)} aria-label="Back 10 seconds (J)" title="Back 10s (J)">
                            <RotateCcw size={18} />
                        </button>
                        <button type="button" className={s.ctl} onClick={() => api.skip(10)} aria-label="Forward 10 seconds (L)" title="Forward 10s (L)">
                            <RotateCw size={18} />
                        </button>
                    </>
                )}
                <div className={s.volume}>
                    <button type="button" className={s.ctl} onClick={api.toggleMute} aria-label={state.muted ? "Unmute (M)" : "Mute (M)"} title={state.muted ? "Unmute (M)" : "Mute (M)"}>
                        <VolIcon size={19} />
                    </button>
                    <input
                        type="range"
                        className={s.volSlider}
                        min={0}
                        max={1}
                        step={0.05}
                        value={state.muted ? 0 : state.volume}
                        onChange={(e) => api.setVolume(Number(e.target.value))}
                        aria-label="Volume"
                    />
                </div>
                <span className={s.time}>
                    {formatVideoTime(state.current)} / {formatVideoTime(state.duration)}
                </span>
                <span className={s.spacer} />
                <div className={s.speedWrap}>
                    <button type="button" className={`${s.ctl} ${s.speedBtn}`} onClick={() => setSpeedOpen((o) => !o)} aria-label="Playback speed" title="Playback speed">
                        {compact ? <Gauge size={18} /> : `${state.speed}x`}
                    </button>
                    {speedOpen && (
                        <div className={s.speedMenu} role="menu">
                            {PLAYBACK_SPEEDS.map((r) => (
                                <button
                                    key={r}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={state.speed === r}
                                    className={state.speed === r ? s.speedActive : ""}
                                    onClick={() => {
                                        api.setSpeed(r);
                                        setSpeedOpen(false);
                                    }}
                                >
                                    {r === 1 ? "Normal" : `${r}x`}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                {api.pipSupported && (
                    <button type="button" className={s.ctl} onClick={api.togglePip} aria-label="Picture in picture" title="Picture in picture">
                        <PictureInPicture2 size={18} />
                    </button>
                )}
                {downloadUrl && !compact && (
                    <a className={s.ctl} href={downloadUrl} download={fileName || true} aria-label="Download" title="Download">
                        <Download size={18} />
                    </a>
                )}
                <button type="button" className={s.ctl} onClick={api.toggleFullscreen} aria-label={state.fullscreen ? "Exit full screen (F)" : "Full screen (F)"} title={state.fullscreen ? "Exit full screen (F)" : "Full screen (F)"}>
                    {state.fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                </button>
            </div>
        </div>
    );
}
