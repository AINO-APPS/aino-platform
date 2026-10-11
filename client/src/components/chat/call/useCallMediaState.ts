import { useEffect, useRef, useState } from "react";

export default function useCallMediaState(
  localMediaStream: MediaStream | null | undefined,
  localStreamRef: React.MutableRefObject<MediaStream | null>,
) {
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(() =>
    !localStreamRef.current?.getVideoTracks?.().some((t) => t.readyState !== "ended" && t.enabled),
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [screenSharing, setScreenSharing] = useState(false);
  const [onHold, setOnHold] = useState(false);
  const onHoldRef = useRef(onHold);
  onHoldRef.current = onHold;
  const mountedRef = useRef(true);
  const heldTracksRef = useRef(new Map<MediaStreamTrack, boolean>());
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    const stream = localMediaStream ?? localStreamRef.current;
    const observed = new Set<MediaStreamTrack>();
    const sync = () => {
      const tracks = stream?.getVideoTracks?.() ?? [];
      tracks.forEach((t) => {
        if (!observed.has(t)) {
          observed.add(t);
          t.addEventListener?.("ended", sync);
        }
      });
      setVideoOff(!tracks.some((t) => t.readyState !== "ended" && t.enabled));
    };
    sync();
    stream?.addEventListener?.("addtrack", sync);
    stream?.addEventListener?.("removetrack", sync);
    return () => {
      stream?.removeEventListener?.("addtrack", sync);
      stream?.removeEventListener?.("removetrack", sync);
      observed.forEach((t) => t.removeEventListener?.("ended", sync));
    };
  }, [localMediaStream, localStreamRef]);

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = !t.enabled;
      });
      setMuted(!muted);
    }
  };

  const toggleHold = () => {
    if (!localStreamRef.current) return;
    const hold = !onHold;
    onHoldRef.current = hold;
    localStreamRef.current.getTracks().forEach((t) => {
      if (hold) heldTracksRef.current.set(t, t.enabled);
      t.enabled = hold ? false : (heldTracksRef.current.get(t) ?? t.enabled);
    });
    if (!hold) heldTracksRef.current.clear();
    setOnHold(hold);
    setMuted(!localStreamRef.current.getAudioTracks().some((t) => t.enabled));
    setVideoOff(!localStreamRef.current.getVideoTracks().some((t) => t.readyState !== "ended" && t.enabled));
  };

  return {
    muted, videoOff, setVideoOff, cameraError, setCameraError,
    screenSharing, setScreenSharing, onHold, onHoldRef, mountedRef,
    heldTracksRef, toggleMute, toggleHold,
  };
}
