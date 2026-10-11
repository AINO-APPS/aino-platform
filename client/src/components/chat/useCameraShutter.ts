import { useEffect, useRef } from "react";
import { CAMERA_HOLD_MS } from "./cameraCapabilities";

export function useCameraShutter({ enabled, videoSupported, takePhoto, startRecording, finish, cancel }: {
  enabled: boolean;
  videoSupported: boolean;
  takePhoto: () => void;
  startRecording: () => void;
  finish: () => void;
  cancel: () => void;
}) {
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; held: boolean } | null>(null);
  const callbacks = useRef({ takePhoto, startRecording, finish, cancel });
  callbacks.current = { takePhoto, startRecording, finish, cancel };
  const suppressClick = useRef(false);

  const abort = () => {
    const current = press.current;
    if (!current) return;
    clearTimeout(current.timer);
    press.current = null;
    if (current.held) callbacks.current.cancel();
  };
  useEffect(() => abort, []);

  return {
    begin() {
      if (!enabled || press.current) return;
      suppressClick.current = true;
      const current = { held: false, timer: setTimeout(() => {
        if (!videoSupported) return;
        current.held = true;
        callbacks.current.startRecording();
      }, CAMERA_HOLD_MS) };
      press.current = current;
    },
    release() {
      const current = press.current;
      if (!current) return;
      clearTimeout(current.timer);
      press.current = null;
      if (current.held) callbacks.current.finish();
      else callbacks.current.takePhoto();
    },
    abort,
    click(detail = 1) {
      if (suppressClick.current && detail !== 0) { suppressClick.current = false; return; }
      suppressClick.current = false;
      if (enabled) callbacks.current.takePhoto();
    },
  };
}
