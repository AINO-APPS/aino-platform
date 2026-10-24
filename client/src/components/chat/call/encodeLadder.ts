/**
 * ENCODER LADDER WRITES
 * =====================
 *
 * Everything that mutates a sender's `setParameters()` lives here, because all
 * of it must be serialised per peer connection. Splitting the writes from the
 * decision logic keeps `callQuality.ts` about *deciding* a rung and this module
 * about *applying* it.
 */

import {
  AUDIO_MAX_BITRATE,
  RAMP_START_TIER_INDEX,
  type VideoEncodingTier,
  type QualityController,
} from "./callQuality";

// ─────────────────────────────────────────────────────────────────────────────
// Serialised encoder writes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One promise chain per RTCPeerConnection. `getParameters()` returns a snapshot
 * carrying a `transactionId`; if a second `setParameters()` is applied before
 * the first resolves, the first REJECTS with InvalidStateError. Every writer
 * (connect ramp, adaptive controller, screen-share swap) must go through here
 * so parameters are always re-read immediately before being mutated.
 */
const applyQueues = new WeakMap<RTCPeerConnection, Promise<unknown>>();

function enqueue<T>(pc: RTCPeerConnection, task: () => Promise<T>): Promise<T> {
  const tail = applyQueues.get(pc) ?? Promise.resolve();
  const next = tail.then(task, task);
  // Keep a swallowed copy as the queue tail so one failure can't poison the chain.
  applyQueues.set(
    pc,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

async function writeVideoTier(
  pc: RTCPeerConnection,
  tier: VideoEncodingTier,
): Promise<boolean> {
  let applied = true;
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "video") continue;
    try {
      // Re-read INSIDE the queued task: any earlier write has already
      // resolved, so this snapshot's transactionId is current.
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0)
        params.encodings = [{}];
      params.encodings[0].maxBitrate = tier.maxBitrate;
      params.encodings[0].maxFramerate = tier.maxFramerate;
      params.encodings[0].scaleResolutionDownBy = tier.scaleResolutionDownBy;
      // "balanced" lets the encoder trade BOTH resolution and framerate as
      // the link degrades, softening gracefully instead of freezing.
      params.degradationPreference = "balanced";
      await sender.setParameters(params);
    } catch (err: any) {
      applied = false;
      // Never silent: a swallowed InvalidStateError here is exactly how the
      // encoder used to get stuck at the connect-time start cap.
      console.warn(
        "[call-quality] setParameters(video) failed:",
        err?.message || err,
      );
    }
  }
  return applied;
}

/** Apply a ladder rung to every video sender. Serialised per peer connection. */
export function applyVideoEncodingTier(
  pc: RTCPeerConnection,
  tier: VideoEncodingTier,
): Promise<boolean> {
  return enqueue(pc, () => writeVideoTier(pc, tier));
}

/** Cap the Opus sender so video adaptation can never starve audio. */
export function applyAudioEncodingCap(
  pc: RTCPeerConnection,
  maxBitrate: number = AUDIO_MAX_BITRATE,
): Promise<boolean> {
  return enqueue(pc, async () => {
    let applied = false;
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== "audio") continue;
      try {
        const params = sender.getParameters();
        if (!params.encodings || params.encodings.length === 0)
          params.encodings = [{}];
        params.encodings[0].maxBitrate = maxBitrate;
        await sender.setParameters(params);
        applied = true;
      } catch (err: any) {
        console.warn(
          "[call-quality] setParameters(audio) failed:",
          err?.message || err,
        );
      }
    }
    return applied;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Connect-time ramp
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk the ladder from `RAMP_START_TIER_INDEX` up to the top rung over a few
 * seconds so the connection establishes on a modest bitrate and only then
 * opens up. Unlike the previous implementation this shares its position with
 * the adaptive controller (`controller.setTierIndex`), so the two can never
 * disagree — and it ABORTS as soon as the controller has moved DOWN, which
 * means a genuinely bad link is no longer fought by the ramp.
 *
 * Returns a cancel function.
 */
export function startBitrateRampUp(
  pc: RTCPeerConnection,
  controller: QualityController,
  options: { stepMs?: number; preserveTier?: boolean } = {},
): () => void {
  const stepMs = options.stepMs ?? 700;
  const timers: ReturnType<typeof setTimeout>[] = [];

  // A reconnect (ICE restart / relay rebuild) is not a fresh call: the ladder
  // position was earned on this same session, so throwing it away would drop
  // the user to 300 kbps and force a slow climb back after every blip.
  const startIndex = options.preserveTier
    ? controller.getTierIndex()
    : RAMP_START_TIER_INDEX;

  controller.setTierIndex(startIndex);
  void applyVideoEncodingTier(pc, controller.getTier());
  void applyAudioEncodingCap(pc);

  for (let step = 1; step <= startIndex; step++) {
    const target = startIndex - step;
    timers.push(
      setTimeout(() => {
        // Only ever move UP from where the controller currently is. If the
        // adaptive loop already dropped us because the link is bad, the
        // ramp must not fight it back up.
        if (controller.getTierIndex() !== target + 1) return;
        controller.setTierIndex(target);
        void applyVideoEncodingTier(pc, controller.getTier());
      }, stepMs * step),
    );
  }

  return () => timers.forEach((t) => clearTimeout(t));
}
