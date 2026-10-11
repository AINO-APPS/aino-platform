export const CAMERA_HOLD_MS = 400;
export const MAX_CAMERA_VIDEO_MS = 60_000;
export const MAX_CAMERA_BYTES = 25 * 1024 * 1024;

export function recordingMimeType(): string | null {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return null;
  return ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find(
    (type) => MediaRecorder.isTypeSupported(type),
  ) ?? null;
}

export interface CameraControls {
  zoom?: { min: number; max: number; step: number };
  torch: boolean;
}

export function cameraControls(track: MediaStreamTrack): CameraControls {
  const caps = track.getCapabilities?.() as (MediaTrackCapabilities & {
    zoom?: { min: number; max: number; step?: number };
    torch?: boolean;
  }) | undefined;
  const zoom = caps?.zoom;
  return {
    zoom: zoom && Number.isFinite(zoom.min) && Number.isFinite(zoom.max) && zoom.min > 0 && zoom.max > zoom.min
      ? { min: zoom.min, max: zoom.max, step: zoom.step && zoom.step > 0 ? zoom.step : 0.1 }
      : undefined,
    torch: caps?.torch === true,
  };
}

export function zoomPresets(min: number, max: number): number[] {
  return [1, 2, 5].filter((ratio) => ratio >= min && ratio <= max);
}

export function validCameraVideo(blob: Blob, durationMs: number): boolean {
  return blob.size > 0 && blob.size <= MAX_CAMERA_BYTES && durationMs > 0 && durationMs <= MAX_CAMERA_VIDEO_MS;
}

export function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
