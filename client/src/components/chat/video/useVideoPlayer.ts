import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const HIDE_AFTER_MS = 3000;

export interface VideoPlayerState {
    playing: boolean;
    current: number;
    duration: number;
    buffered: number;
    volume: number;
    muted: boolean;
    speed: number;
    fullscreen: boolean;
    pip: boolean;
    waiting: boolean;
    ended: boolean;
    controlsVisible: boolean;
}

/**
 * State + commands for a custom-controlled <video> (Teams-style): play/pause,
 * seek, volume, speed, picture-in-picture, fullscreen and auto-hiding chrome.
 */
export function useVideoPlayer(
    videoRef: RefObject<HTMLVideoElement | null>,
    containerRef: RefObject<HTMLElement | null>,
) {
    const [st, setSt] = useState<VideoPlayerState>({
        playing: false,
        current: 0,
        duration: 0,
        buffered: 0,
        volume: 1,
        muted: false,
        speed: 1,
        fullscreen: false,
        pip: false,
        waiting: false,
        ended: false,
        controlsVisible: true,
    });
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const patch = useCallback((p: Partial<VideoPlayerState>) => setSt((s) => ({ ...s, ...p })), []);

    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        const sync = () => {
            const b = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
            patch({
                current: v.currentTime,
                duration: Number.isFinite(v.duration) ? v.duration : 0,
                buffered: b,
            });
        };
        const handlers: Record<string, () => void> = {
            play: () => patch({ playing: true, ended: false }),
            pause: () => patch({ playing: false, controlsVisible: true }),
            ended: () => patch({ playing: false, ended: true, controlsVisible: true }),
            timeupdate: sync,
            durationchange: sync,
            loadedmetadata: sync,
            progress: sync,
            waiting: () => patch({ waiting: true }),
            playing: () => patch({ waiting: false }),
            canplay: () => patch({ waiting: false }),
            volumechange: () => patch({ volume: v.volume, muted: v.muted }),
            ratechange: () => patch({ speed: v.playbackRate }),
            enterpictureinpicture: () => patch({ pip: true }),
            leavepictureinpicture: () => patch({ pip: false }),
        };
        Object.entries(handlers).forEach(([e, h]) => v.addEventListener(e, h));
        return () => Object.entries(handlers).forEach(([e, h]) => v.removeEventListener(e, h));
    }, [videoRef, patch]);

    useEffect(() => {
        const onFs = () => patch({ fullscreen: document.fullscreenElement === containerRef.current });
        document.addEventListener("fullscreenchange", onFs);
        return () => document.removeEventListener("fullscreenchange", onFs);
    }, [containerRef, patch]);

    useEffect(() => () => {
        if (hideTimer.current) clearTimeout(hideTimer.current);
    }, []);

    const poke = useCallback(() => {
        patch({ controlsVisible: true });
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => {
            if (videoRef.current && !videoRef.current.paused) patch({ controlsVisible: false });
        }, HIDE_AFTER_MS);
    }, [patch, videoRef]);

    const toggle = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused || v.ended) void v.play().catch(() => undefined);
        else v.pause();
        poke();
    }, [videoRef, poke]);

    const seekTo = useCallback(
        (t: number) => {
            const v = videoRef.current;
            if (!v) return;
            const d = Number.isFinite(v.duration) ? v.duration : 0;
            v.currentTime = Math.max(0, d ? Math.min(d, t) : t);
            patch({ current: v.currentTime, ended: false });
            poke();
        },
        [videoRef, patch, poke],
    );
    const skip = useCallback((delta: number) => seekTo((videoRef.current?.currentTime || 0) + delta), [seekTo, videoRef]);

    const setVolume = useCallback(
        (vol: number) => {
            const v = videoRef.current;
            if (!v) return;
            v.volume = Math.max(0, Math.min(1, vol));
            v.muted = v.volume === 0;
            poke();
        },
        [videoRef, poke],
    );
    const toggleMute = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
        if (!v.muted && v.volume === 0) v.volume = 0.6;
        poke();
    }, [videoRef, poke]);

    const setSpeed = useCallback(
        (rate: number) => {
            if (videoRef.current) videoRef.current.playbackRate = rate;
            patch({ speed: rate });
            poke();
        },
        [videoRef, patch, poke],
    );

    const toggleFullscreen = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
        else void el.requestFullscreen?.().catch(() => undefined);
    }, [containerRef]);

    const pipSupported = typeof document !== "undefined" && !!document.pictureInPictureEnabled;
    const togglePip = useCallback(() => {
        const v = videoRef.current as (HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }) | null;
        if (!v) return;
        if (document.pictureInPictureElement) void document.exitPictureInPicture?.().catch(() => undefined);
        else void v.requestPictureInPicture?.().catch(() => undefined);
    }, [videoRef]);

    /** Teams/YouTube shortcuts. Returns true when the key was handled. */
    const handleKey = useCallback(
        (e: { key: string; preventDefault: () => void }) => {
            const k = e.key.toLowerCase();
            const map: Record<string, () => void> = {
                " ": toggle,
                k: toggle,
                arrowleft: () => skip(-5),
                arrowright: () => skip(5),
                j: () => skip(-10),
                l: () => skip(10),
                m: toggleMute,
                f: toggleFullscreen,
                arrowup: () => setVolume((videoRef.current?.volume ?? 1) + 0.1),
                arrowdown: () => setVolume((videoRef.current?.volume ?? 1) - 0.1),
            };
            const fn = map[k];
            if (!fn) return false;
            e.preventDefault();
            fn();
            return true;
        },
        [toggle, skip, toggleMute, toggleFullscreen, setVolume, videoRef],
    );

    return {
        state: st,
        toggle,
        seekTo,
        skip,
        setVolume,
        toggleMute,
        setSpeed,
        toggleFullscreen,
        togglePip,
        pipSupported,
        poke,
        handleKey,
    };
}

export type VideoPlayerApi = ReturnType<typeof useVideoPlayer>;
