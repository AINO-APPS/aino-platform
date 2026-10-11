import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { cameraControls, MAX_CAMERA_BYTES, MAX_CAMERA_VIDEO_MS, recordingMimeType, stopTracks, validCameraVideo, type CameraControls } from "./cameraCapabilities";

type Phase = "starting" | "ready" | "photo" | "audio" | "recording" | "stopping";
interface RecordingSession {
  recorder: MediaRecorder;
  audio: MediaStream | null;
  chunks: Blob[];
  bytes: number;
  started: number;
  duration: number;
  token: number;
  timer: ReturnType<typeof setTimeout>;
  ticker: ReturnType<typeof setInterval>;
  cleanupAudio: () => void;
}

export function useCameraCapture(videoRef: RefObject<HTMLVideoElement | null>, onCapture: (file: File) => void, onClose: () => void) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [controls, setControls] = useState<CameraControls>({ torch: false });
  const [zoom, setZoom] = useState(1);
  const [torch, setTorch] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [needsSilent, setNeedsSilent] = useState(false);
  const [silent, setSilent] = useState(false);
  const [mime] = useState(recordingMimeType);
  const active = useRef(false);
  const cameraToken = useRef(0);
  const captureToken = useRef(0);
  const busy = useRef(true);
  const stream = useRef<MediaStream | null>(null);
  const session = useRef<RecordingSession | null>(null);
  const audioDenied = useRef(false);
  const audioPending = useRef(false);
  const controlToken = useRef(0);
  const silentAccepted = useRef(false);
  const trackCleanup = useRef<(() => void) | null>(null);
  const callbacks = useRef({ onCapture, onClose });
  callbacks.current = { onCapture, onClose };

  const detachRecording = useCallback(() => {
    const current = session.current;
    session.current = null;
    if (!current) return;
    clearTimeout(current.timer);
    clearInterval(current.ticker);
    current.recorder.ondataavailable = null;
    current.recorder.onstop = null;
    current.recorder.onerror = null;
    if (current.recorder.state !== "inactive") {
      try { current.recorder.stop(); } catch { /* Already stopped by the device. */ }
    }
    current.cleanupAudio();
    stopTracks(current.audio);
    current.chunks.length = 0;
  }, []);

  const cancel = useCallback(() => {
    ++captureToken.current;
    detachRecording();
    busy.current = false;
    if (active.current) { setPhase("ready"); setElapsed(0); }
  }, [detachRecording]);

  const stopCamera = useCallback(() => {
    trackCleanup.current?.();
    trackCleanup.current = null;
    stopTracks(stream.current);
    stream.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [videoRef]);

  const dispose = useCallback(() => {
    active.current = false;
    ++cameraToken.current;
    ++captureToken.current;
    detachRecording();
    stopCamera();
  }, [detachRecording, stopCamera]);

  const close = useCallback(() => {
    dispose();
    callbacks.current.onClose();
  }, [dispose]);

  const startCamera = useCallback(async (id?: string) => {
    if (!active.current || session.current) return;
    const token = ++cameraToken.current;
    ++captureToken.current;
    busy.current = true;
    stopCamera();
    setPhase("starting"); setError(null); setControls({ torch: false }); setTorch(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is unavailable in this browser. Use the gallery instead.");
      const next = await navigator.mediaDevices.getUserMedia({ video: id ? { deviceId: { exact: id } } : { facingMode: { ideal: "environment" } }, audio: false });
      if (!active.current || token !== cameraToken.current) { stopTracks(next); return; }
      const track = next.getVideoTracks()[0];
      if (!track || track.readyState === "ended") { stopTracks(next); throw new Error("No camera was found on this device."); }
      stream.current = next;
      const ended = () => { cancel(); stopCamera(); setError("Camera disconnected. Try again or choose a file from the gallery."); };
      track.addEventListener("ended", ended);
      trackCleanup.current = () => track.removeEventListener("ended", ended);
      const caps = cameraControls(track);
      const settings = track.getSettings?.() ?? {};
      setControls(caps); setZoom((settings as MediaTrackSettings & { zoom?: number }).zoom ?? Math.max(caps.zoom?.min ?? 1, 1));
      setDeviceId(settings.deviceId ?? id ?? "");
      if (videoRef.current) {
        videoRef.current.srcObject = next;
        await videoRef.current.play();
      }
      if (!active.current || token !== cameraToken.current) return;
      busy.current = false; setPhase("ready");
      if (navigator.mediaDevices.enumerateDevices) {
        const found = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (active.current && token === cameraToken.current) setDevices(found.filter((device) => device.kind === "videoinput" && device.deviceId));
      }
    } catch (err) {
      if (!active.current || token !== cameraToken.current) return;
      stopCamera(); busy.current = false; setPhase("ready");
      setError((err as Error).name === "NotAllowedError" ? "Camera access was blocked. Allow camera access and try again, or use the gallery." : (err as Error).message || "Could not start the camera.");
    }
  }, [cancel, stopCamera, videoRef]);

  useEffect(() => {
    active.current = true;
    void startCamera();
    const background = () => { if (document.visibilityState === "hidden") close(); };
    const pageHide = () => close();
    document.addEventListener("visibilitychange", background);
    window.addEventListener("pagehide", pageHide);
    return () => {
      document.removeEventListener("visibilitychange", background);
      window.removeEventListener("pagehide", pageHide);
      dispose();
    };
  }, [close, dispose, startCamera]);

  const deliver = useCallback((file: File) => {
    dispose();
    callbacks.current.onCapture(file);
    callbacks.current.onClose();
  }, [dispose]);

  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!active.current || busy.current || !stream.current || !video?.videoWidth || !video.videoHeight) return;
    busy.current = true; setPhase("photo"); setError(null);
    const token = ++captureToken.current;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not capture a photo.");
      context.drawImage(video, 0, 0);
      canvas.toBlob((blob) => {
        if (!active.current || token !== captureToken.current) return;
        if (!blob || blob.size === 0 || blob.size > MAX_CAMERA_BYTES) {
          busy.current = false; setPhase("ready"); setError("Could not capture a photo within the 25 MiB limit."); return;
        }
        deliver(new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
      }, "image/jpeg", 0.92);
    } catch (err) {
      if (active.current && token === captureToken.current) { busy.current = false; setPhase("ready"); setError((err as Error).message); }
    }
  }, [deliver, videoRef]);

  const finish = useCallback(() => {
    const current = session.current;
    if (!current) { cancel(); return; }
    if (current.recorder.state === "inactive") return;
    current.duration = performance.now() - current.started;
    clearTimeout(current.timer); clearInterval(current.ticker);
    setElapsed(current.duration); setPhase("stopping");
    try { current.recorder.stop(); } catch { cancel(); setError("Could not finish the video."); }
  }, [cancel]);

  const startRecording = useCallback(async (withoutSound = false) => {
    if (!active.current || busy.current || audioPending.current || !stream.current || !mime) return;
    if (audioDenied.current && !silentAccepted.current && !withoutSound) { setNeedsSilent(true); return; }
    if (withoutSound) { silentAccepted.current = true; setNeedsSilent(false); }
    const token = ++captureToken.current;
    busy.current = true; setPhase("audio"); setError(null); setElapsed(0);
    let audio: MediaStream | null = null;
    try {
      if (!silentAccepted.current) {
        audioPending.current = true;
        try { audio = await navigator.mediaDevices.getUserMedia({ video: false, audio: true }); }
        catch {
          audioDenied.current = true;
          if (active.current && token === captureToken.current) { busy.current = false; setPhase("ready"); setNeedsSilent(true); }
          return;
        } finally { audioPending.current = false; }
      }
      if (!active.current || token !== captureToken.current) { stopTracks(audio); return; }
      if (audio && !audio.getAudioTracks().some((track) => track.readyState !== "ended")) {
        stopTracks(audio); audioDenied.current = true; busy.current = false; setPhase("ready"); setNeedsSilent(true); return;
      }
      const source = new MediaStream([...stream.current!.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])]);
      const recorder = new MediaRecorder(source, { mimeType: mime, videoBitsPerSecond: 2_000_000 });
      const audioEnded = () => { if (active.current && token === captureToken.current) { cancel(); setError("Microphone disconnected. Recording was discarded."); } };
      audio?.getAudioTracks().forEach((track) => track.addEventListener("ended", audioEnded));
      const current: RecordingSession = {
        recorder, audio, chunks: [], bytes: 0, started: performance.now(), duration: 0, token,
        cleanupAudio: () => audio?.getAudioTracks().forEach((track) => track.removeEventListener("ended", audioEnded)),
        // Leave one recorder timeslice for stop scheduling; final duration still has a hard ceiling.
        timer: setTimeout(finish, MAX_CAMERA_VIDEO_MS - 250),
        ticker: setInterval(() => { if (active.current && token === captureToken.current) setElapsed(Math.min(MAX_CAMERA_VIDEO_MS, performance.now() - current.started)); }, 100),
      };
      session.current = current;
      recorder.ondataavailable = (event) => {
        if (!active.current || token !== captureToken.current || !event.data.size) return;
        if (current.bytes + event.data.size > MAX_CAMERA_BYTES) { cancel(); setError("Video exceeded 25 MiB and was discarded. Record a shorter video."); return; }
        current.chunks.push(event.data); current.bytes += event.data.size;
        if (current.bytes >= MAX_CAMERA_BYTES && recorder.state !== "inactive") finish();
      };
      recorder.onerror = () => { if (active.current && token === captureToken.current) { cancel(); setError("Recording failed. Photos are still available."); } };
      recorder.onstop = () => {
        if (!active.current || token !== captureToken.current) return;
        const duration = current.duration || performance.now() - current.started;
        const blob = new Blob(current.chunks, { type: recorder.mimeType || mime });
        detachRecording(); busy.current = false;
        if (!validCameraVideo(blob, duration)) { setPhase("ready"); setError("Video must be non-empty, at most 60 seconds and 25 MiB."); return; }
        deliver(new File([blob], `video-${Date.now()}.${blob.type.startsWith("video/mp4") ? "mp4" : "webm"}`, { type: blob.type }));
      };
      recorder.start(250);
      setSilent(!audio); setPhase("recording");
    } catch {
      stopTracks(audio);
      if (active.current && token === captureToken.current) { cancel(); setError("Could not start recording. Photos are still available."); }
    }
  }, [cancel, deliver, detachRecording, finish, mime]);

  const applyControl = useCallback(async (values: { zoom?: number; torch?: boolean }) => {
    const track = stream.current?.getVideoTracks()[0];
    if (!active.current || busy.current || !track?.applyConstraints) return;
    const token = cameraToken.current;
    const control = ++controlToken.current;
    try {
      await track.applyConstraints({ advanced: [values as MediaTrackConstraintSet] });
      if (active.current && token === cameraToken.current && control === controlToken.current) {
        if (values.zoom !== undefined) setZoom(values.zoom);
        if (values.torch !== undefined) setTorch(values.torch);
      }
    } catch {
      if (active.current && token === cameraToken.current && control === controlToken.current) setError("This camera could not apply that control.");
    }
  }, []);

  const canCapture = !!stream.current?.getVideoTracks().some((track) => track.readyState !== "ended");
  return { phase, error, devices, deviceId, controls, zoom, torch, elapsed, needsSilent, silent, canCapture, videoSupported: !!mime,
    takePhoto, startRecording, finish, cancel, close, startCamera, applyControl };
}
