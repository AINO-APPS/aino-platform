import { AlertCircle as MaterialAlertCircle, X as MaterialX, Trash2 as MaterialTrash2, Send as MaterialSend } from "../../constants/icons";
/* eslint-disable @typescript-eslint/no-explicit-any */
import s from "./VoiceRecorder.module.css";
import { useState, useRef, useCallback, useEffect } from "react";

interface VoiceRecorderProps {
    onSend: (blob: Blob, duration: number, ext: string) => void;
    onCancel?: () => void;
}

export default function VoiceRecorder({ onSend, onCancel }: VoiceRecorderProps) {
    const [recording, setRecording] = useState(false);
    const [duration, setDuration] = useState(0);
    const [error, setError] = useState("");
    const mediaRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const durationRef = useRef(0);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const rafRef = useRef<number | null>(null);
    const barsRef = useRef<HTMLDivElement | null>(null);

    const NUM_BARS = 28;

    const drawWaveform = useCallback(() => {
        const analyser = analyserRef.current;
        const bars = barsRef.current;
        if (!analyser || !bars) return;
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const step = Math.floor(data.length / NUM_BARS);
        const children = bars.children;
        for (let i = 0; i < NUM_BARS && i < children.length; i++) {
            const val = data[i * step] / 255;
            const height = Math.max(4, val * 28);
            (children[i] as HTMLElement).style.height = `${height}px`;
        }
        rafRef.current = requestAnimationFrame(drawWaveform);
    }, []);

    const start = useCallback(async () => {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            setError("Voice messages require HTTPS");
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            // Set up audio analyser for waveform
            const audioCtx = new AudioContext();
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);
            analyserRef.current = analyser;

            const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm"
                : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
            const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            const ext = (mr.mimeType || mimeType || "").includes("mp4") ? "mp4" : "webm";
            mediaRef.current = mr;
            chunksRef.current = [];
            mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
            mr.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
                stream.getTracks().forEach(t => t.stop());
                audioCtx.close();
                onSend(blob, durationRef.current, ext);
            };
            mr.start();
            setRecording(true);
            setDuration(0);
            durationRef.current = 0;
            timerRef.current = setInterval(() => setDuration(d => { durationRef.current = d + 1; return d + 1; }), 1000);
            rafRef.current = requestAnimationFrame(drawWaveform);
        } catch (err: any) {
            const msg = err?.name === "NotAllowedError"
                ? "Microphone blocked — click the lock/tune icon in the address bar to allow microphone. If the setting is locked, your organization may be blocking it."
                : err?.name === "NotFoundError"
                ? "No microphone found"
                : "Could not access microphone";
            setError(msg);
        }
    }, [onSend, drawWaveform]);

    const stop = useCallback(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        if (mediaRef.current?.state === "recording") mediaRef.current.stop();
        setRecording(false);
    }, []);

    const cancel = useCallback(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        if (mediaRef.current?.state === "recording") {
            mediaRef.current.onstop = null;
            mediaRef.current.stop();
        }
        streamRef.current?.getTracks().forEach(t => t.stop());
        setRecording(false);
        onCancel?.();
    }, [onCancel]);

    const startRef = useRef(start);
    startRef.current = start;

    useEffect(() => {
        startRef.current();
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            streamRef.current?.getTracks().forEach(t => t.stop());
        };
    }, []);

    // Auto-dismiss error after 3s
    useEffect(() => {
        if (!error) return;
        const t = setTimeout(() => onCancel?.(), 3000);
        return () => clearTimeout(t);
    }, [error, onCancel]);

    const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

    if (error) {
        return (
            <div className={s.recorderError}>
                <MaterialAlertCircle size="16" className={s.errorIcon} width="16" height="16" />
                <span className={s.errorMsg}>{error}</span>
                <button className={s.cancelBtn} onClick={cancel} title="Close">
                    <MaterialX size="14" width="14" height="14" />
                </button>
            </div>
        );
    }

    return (
        <div className={s.recorder}>
            <button className={s.cancelBtn} onClick={cancel} title="Cancel recording">
                <MaterialTrash2 size="18" width="18" height="18" />
            </button>

            <div className={s.liveIndicator}>
                <span className={s.dot} />
                <span className={s.time}>{fmt(duration)}</span>
            </div>

            <div className={s.waveform} ref={barsRef}>
                {Array.from({ length: NUM_BARS }, (_, i) => (
                    <span key={i} className={s.bar} />
                ))}
            </div>

            <button className={s.sendBtn} onClick={stop} title="Send voice message">
                <MaterialSend size="20" width="20" height="20" />
            </button>
        </div>
    );
}