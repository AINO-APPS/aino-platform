export function buildMeetingMediaProfiles(
  wantVideo: boolean,
  isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
): MediaStreamConstraints[] {
  const audio = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (!wantVideo) return [{ audio, video: false }];
  if (isMobile) {
    return [
      {
        audio,
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24, max: 30 },
        },
      },
      { audio, video: true },
      { audio, video: false },
    ];
  }
  return [
    {
      audio,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
    },
    {
      audio,
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 24, max: 30 },
      },
    },
    {
      audio,
      video: {
        width: { ideal: 320 },
        height: { ideal: 240 },
        frameRate: { ideal: 15, max: 24 },
      },
    },
    { audio, video: true },
    { audio, video: false },
  ];
}

export async function acquireMeetingMedia(
  wantVideo: boolean,
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("NoMediaDevices");
  const profiles = buildMeetingMediaProfiles(wantVideo);
  let lastError: unknown;
  for (let index = 0; index < profiles.length; index += 1) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(profiles[index]);
      if (index > 0)
        console.warn(`[meeting] media acquired with reduced profile #${index}`);
      return stream;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
