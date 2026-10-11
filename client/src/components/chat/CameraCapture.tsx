import { useEffect, useRef, useState } from "react";
import { Camera, Image, MicOff, Square, SwitchCamera, Video, X, Zap, ZapOff } from "../../constants/icons";
import { zoomPresets } from "./cameraCapabilities";
import { useCameraCapture } from "./useCameraCapture";
import { useCameraShutter } from "./useCameraShutter";
import s from "./CameraCapture.module.css";

interface CameraCaptureProps {
  onCapture: (file: File) => void;
  onClose: () => void;
  onGallery: () => void;
}

export default function CameraCapture({ onCapture, onClose, onGallery }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<"photo" | "video">("photo");
  const camera = useCameraCapture(videoRef, onCapture, onClose);
  const ready = camera.phase === "ready" && camera.canCapture;
  const recording = camera.phase === "recording";
  const shutter = useCameraShutter({
    enabled: ready, videoSupported: camera.videoSupported,
    takePhoto: camera.takePhoto, startRecording: camera.startRecording,
    finish: camera.finish, cancel: camera.cancel,
  });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  useEffect(() => {
    modalRef.current?.focus();
  }, []);

  const setZoom = (value: number) => {
    const range = camera.controls.zoom;
    if (!range) return;
    const next = Math.max(range.min, Math.min(range.max, range.min + Math.round((value - range.min) / range.step) * range.step));
    void camera.applyControl({ zoom: next });
  };
  const clearPointer = (id: number) => { pointers.current.delete(id); pinch.current = null; };
  const isPhoto = mode === "photo";
  const timer = `${Math.floor(camera.elapsed / 60_000).toString().padStart(2, "0")}:${Math.floor(camera.elapsed / 1000 % 60).toString().padStart(2, "0")}`;

  return (
    <div className={s.overlay} onClick={camera.close}>
      <div
        ref={modalRef} className={s.modal} role="dialog" aria-modal="true" aria-label="Camera" tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); shutter.abort(); camera.close(); }
          if (event.key === "Tab") {
            const items = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")];
            const first = items[0]; const last = items[items.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === modalRef.current)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}
      >
        <div className={s.header}>
          <span className={s.title}>Camera</span>
          <button type="button" className={s.closeBtn} onClick={camera.close} aria-label="Close camera"><X size={18} /></button>
        </div>
        <div
          className={`${s.body} ${camera.controls.zoom ? s.zoomable : ""}`}
          onWheel={(event) => { if (camera.controls.zoom && ready) setZoom(camera.zoom - event.deltaY * 0.01); }}
          onPointerDown={(event) => {
            if (!camera.controls.zoom || !ready) return;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()];
              pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: camera.zoom };
            }
          }}
          onPointerMove={(event) => {
            if (!pointers.current.has(event.pointerId)) return;
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pinch.current && pointers.current.size === 2 && pinch.current.distance > 0) {
              const [a, b] = [...pointers.current.values()];
              setZoom(pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.distance);
            }
          }}
          onPointerUp={(event) => clearPointer(event.pointerId)}
          onPointerCancel={(event) => clearPointer(event.pointerId)}
          onLostPointerCapture={(event) => clearPointer(event.pointerId)}
        >
          <video ref={videoRef} className={s.video} playsInline muted autoPlay aria-label="Live camera preview" />
          {camera.phase === "starting" && <div className={s.starting}>Starting camera…</div>}
          {(recording || camera.phase === "stopping") && <output className={s.timer} aria-label="Recording duration">{timer} / 01:00</output>}
        </div>
        <div className={s.status} aria-live="polite">
          {camera.error && <p role="alert">{camera.error} {camera.phase === "ready" && <button type="button" className={s.retryBtn} onClick={() => void camera.startCamera(camera.deviceId || undefined)}>Try again</button>}</p>}
          {!camera.videoSupported && <p>Video recording is unavailable. Photos and gallery are still available.</p>}
          {(recording || camera.phase === "stopping") && <p>{camera.silent ? <><MicOff size={16} /> Recording without sound</> : "Recording video"}</p>}
          {camera.phase === "audio" && <p>Waiting for microphone permission…</p>}
          {camera.phase === "photo" && <p>Preparing photo…</p>}
          {camera.phase === "stopping" && <p>Finishing video…</p>}
          {camera.needsSilent && <p>Microphone unavailable. <button type="button" className={s.secondaryBtn} onClick={() => void camera.startRecording(true)}>Record without sound</button></p>}
        </div>
        <div className={s.controls}>
          {camera.devices.length > 1 && <label className={s.deviceControl}><SwitchCamera size={18} /><select aria-label="Switch camera" value={camera.deviceId} disabled={!ready} onChange={(event) => void camera.startCamera(event.target.value)}>{camera.devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>}
          {camera.controls.torch && <button type="button" className={s.secondaryBtn} disabled={!ready} aria-label="Camera light" aria-pressed={camera.torch} onClick={() => void camera.applyControl({ torch: !camera.torch })}>{camera.torch ? <Zap size={18} /> : <ZapOff size={18} />} Light {camera.torch ? "on" : "off"}</button>}
          {camera.controls.zoom && <div className={s.zoomControls}><label>Zoom <input aria-label="Camera zoom" type="range" min={camera.controls.zoom.min} max={camera.controls.zoom.max} step={camera.controls.zoom.step} value={camera.zoom} disabled={!ready} onChange={(event) => setZoom(Number(event.target.value))} /></label><span>{camera.zoom.toFixed(1)}×</span>{zoomPresets(camera.controls.zoom.min, camera.controls.zoom.max).map((ratio) => <button type="button" key={ratio} className={s.secondaryBtn} disabled={!ready} aria-pressed={Math.abs(camera.zoom - ratio) < .05} onClick={() => setZoom(ratio)}>{ratio}×</button>)}</div>}
        </div>
        <div className={s.modes} role="group" aria-label="Capture mode">
          <button type="button" className={s.secondaryBtn} disabled={!ready} aria-pressed={isPhoto} onClick={() => setMode("photo")}>Photo</button>
          <button type="button" className={s.secondaryBtn} disabled={!ready || !camera.videoSupported} aria-pressed={!isPhoto} onClick={() => setMode("video")}>Video</button>
        </div>
        <div className={s.footer}>
          <button type="button" className={s.secondaryBtn} onClick={() => { shutter.abort(); camera.close(); onGallery(); }} aria-label="Open gallery"><Image size={20} /> Gallery</button>
          <button
            type="button" className={`${s.captureBtn} ${recording ? s.recording : ""}`}
            disabled={!ready && !recording && camera.phase !== "audio"}
            aria-label={recording || camera.phase === "audio" ? "Stop recording" : isPhoto ? "Capture photo" : "Start recording"}
            aria-describedby="camera-shutter-help"
            onPointerDown={(event) => { if (!isPhoto || event.button !== 0 || !ready) return; event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); shutter.begin(); }}
            onPointerUp={() => { if (isPhoto) shutter.release(); }}
            onPointerCancel={shutter.abort} onLostPointerCapture={shutter.abort}
            onKeyDown={(event) => { if (isPhoto && ready && (event.key === " " || event.key === "Enter")) { event.preventDefault(); if (!event.repeat) shutter.begin(); } }}
            onKeyUp={(event) => { if (isPhoto && (event.key === " " || event.key === "Enter")) { event.preventDefault(); shutter.release(); } }}
            onBlur={shutter.abort}
            onClick={(event) => { if (recording || camera.phase === "audio") camera.finish(); else if (isPhoto) shutter.click(event.detail); else void camera.startRecording(); }}
          >
            {recording || camera.phase === "audio" ? <Square size={22} /> : isPhoto ? <Camera size={22} /> : <Video size={22} />}
          </button>
          {(recording || camera.phase === "audio") && <button type="button" className={s.secondaryBtn} onClick={() => { shutter.abort(); camera.cancel(); }}>Discard recording</button>}
        </div>
        <p id="camera-shutter-help" className={s.help}>{isPhoto ? camera.videoSupported ? "Tap for photo. Hold for video; release to finish." : "Tap to take a photo." : "Tap to start or stop video."} Space or Enter also activates the shutter. Video limit: 60 seconds / 25 MiB.</p>
      </div>
    </div>
  );
}
