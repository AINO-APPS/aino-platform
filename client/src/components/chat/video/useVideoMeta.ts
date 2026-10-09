import { useEffect, useState } from "react";

export interface VideoMeta {
    poster: string | null;
    duration: number;
    width: number;
    height: number;
}

const metaCache = new Map<string, VideoMeta>();
const EMPTY: VideoMeta = { poster: null, duration: 0, width: 0, height: 0 };

/**
 * Grabs a poster frame (~100ms in, like Android's `videoFrameMillis(100)`),
 * the duration and the intrinsic size from a muted, metadata-only <video>.
 * Results are cached per URL so remounts paint instantly.
 */
export function useVideoMeta(url: string, enabled = true): VideoMeta {
    const [meta, setMeta] = useState<VideoMeta>(() => metaCache.get(url) || EMPTY);

    useEffect(() => {
        if (!enabled || !url) return;
        const cached = metaCache.get(url);
        if (cached?.poster) {
            setMeta(cached);
            return;
        }
        let cancelled = false;
        const video = document.createElement("video");
        video.preload = "metadata";
        video.muted = true;
        video.playsInline = true;
        video.src = url;

        const publish = (patch: Partial<VideoMeta>) => {
            if (cancelled) return;
            const next = { ...(metaCache.get(url) || EMPTY), ...patch };
            metaCache.set(url, next);
            setMeta(next);
        };
        const capture = () => {
            if (cancelled) return;
            const w = video.videoWidth;
            const h = video.videoHeight;
            if (!w || !h) return;
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            try {
                ctx.drawImage(video, 0, 0, w, h);
                canvas.toBlob(
                    (blob) => {
                        if (blob) publish({ poster: URL.createObjectURL(blob) });
                    },
                    "image/jpeg",
                    0.8,
                );
            } catch {
                /* tainted canvas (cross-origin without CORS): keep the fallback tile */
            }
        };
        const onMeta = () =>
            publish({
                duration: Number.isFinite(video.duration) ? video.duration : 0,
                width: video.videoWidth,
                height: video.videoHeight,
            });
        const onData = () => {
            try {
                video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
            } catch {
                capture();
            }
        };
        video.addEventListener("loadedmetadata", onMeta);
        video.addEventListener("loadeddata", onData);
        video.addEventListener("seeked", capture);
        return () => {
            cancelled = true;
            video.removeEventListener("loadedmetadata", onMeta);
            video.removeEventListener("loadeddata", onData);
            video.removeEventListener("seeked", capture);
            video.removeAttribute("src");
            video.load();
        };
    }, [url, enabled]);

    return meta;
}

export function formatVideoTime(sec: number): string {
    if (!sec || !Number.isFinite(sec) || sec < 0) return "0:00";
    const total = Math.floor(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * Signal/Android `ThumbnailView.fillTargetDimensions`: fit the natural size
 * into [minW, maxW] x [minH, maxH], preserving aspect where possible.
 */
export function fillTargetDimensions(
    naturalW: number,
    naturalH: number,
    minW = 150,
    maxW = 240,
    minH = 100,
    maxH = 320,
): { width: number; height: number } {
    if (!naturalW || !naturalH) return { width: 210, height: 210 };
    let width = naturalW;
    let height = naturalH;
    if (width >= minW && width <= maxW && height >= minH && height <= maxH) return { width, height };
    const maxWR = naturalW / maxW;
    const maxHR = naturalH / maxH;
    const minWR = naturalW / minW;
    const minHR = naturalH / minH;
    if (maxWR > 1 || maxHR > 1) {
        const r = Math.max(maxWR, maxHR);
        width = Math.max(minW, width / r);
        height = Math.max(minH, height / r);
    } else if (minWR < 1 || minHR < 1) {
        const r = Math.min(minWR, minHR);
        width = Math.min(maxW, width / r);
        height = Math.min(maxH, height / r);
    }
    return { width: Math.round(width), height: Math.round(height) };
}
