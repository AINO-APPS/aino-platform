/** Ordered acquisition profiles. Later entries deliberately trade quality for reachability. */
export function buildMediaConstraintProfiles(
  isVideoCall: boolean,
  isMobile: boolean,
): MediaStreamConstraints[] {
  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (!isVideoCall) return [{ audio, video: false }, { audio: true, video: false }];
  if (isMobile) {
    return [
      {
        audio,
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24, max: 30 },
          facingMode: "user",
        },
      },
      { audio, video: true },
      { audio, video: false },
    ];
  }
  const tieredProfiles: MediaStreamConstraints[] = [1280, 640, 320].map((width, index) => ({
    audio,
    video: {
      width: { ideal: width },
      height: { ideal: [720, 480, 240][index] },
      frameRate: { ideal: [30, 24, 15][index], max: index === 0 ? 30 : 24 + (index === 1 ? 6 : 0) },
      facingMode: "user",
    },
  }));
  return tieredProfiles.concat([{ audio, video: true }, { audio, video: false }]);
}