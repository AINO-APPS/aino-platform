/**
 * ADAPTIVE VIDEO QUALITY CONTROLLER (1:1 calls)
 * =============================================
 *
 * Received-media loss, freezes and jitter grade the badge, not our encoder.
 * Only uplink feedback and excess RTT move the sender cap. Otherwise a frozen
 * remote stream needlessly reconfigures our healthy encoder too.
 * Interval loss, a learned RTT baseline, slow recovery and serialized writes
 * keep transient problems from pinning quality or causing resolution flapping.
 */

export type ConnectionQuality = "good" | "fair" | "poor" | "unknown";

/** One rung of the quality ladder. Bitrate, resolution and framerate move together. */
export interface VideoEncodingTier {
  maxBitrate: number;
  /** 1 = native resolution, 2 = half width & height. */
  scaleResolutionDownBy: number;
  maxFramerate: number;
}

/**
 * The ladder, best → worst. Framerate drops with bitrate: the old code forced
 * `maxFramerate: 30` even at 200 kbps, which guarantees the encoder drops
 * frames (a freeze) instead of degrading smoothly.
 */
export const VIDEO_TIERS: readonly VideoEncodingTier[] = [
  { maxBitrate: 1_500_000, scaleResolutionDownBy: 1, maxFramerate: 30 },
  { maxBitrate: 800_000, scaleResolutionDownBy: 1, maxFramerate: 30 },
  { maxBitrate: 500_000, scaleResolutionDownBy: 1, maxFramerate: 24 },
  { maxBitrate: 300_000, scaleResolutionDownBy: 1.5, maxFramerate: 20 },
  { maxBitrate: 150_000, scaleResolutionDownBy: 2, maxFramerate: 15 },
];

/** Mobile uplinks are the usual bottleneck — cap the top rung lower. */
export const MOBILE_TOP_TIER_BITRATE = 1_200_000;

export const BOTTOM_TIER_INDEX = VIDEO_TIERS.length - 1;
/** Connect-time ramp starts here (low = fast, stable connect) and walks up. */
export const RAMP_START_TIER_INDEX = 3;

/** Opus is capped separately — video adaptation must never starve audio. */
export const AUDIO_MAX_BITRATE = 48_000;

export function buildTiers(isMobile: boolean): VideoEncodingTier[] {
  return VIDEO_TIERS.map((tier, index) =>
    index === 0 && isMobile
      ? {
          ...tier,
          maxBitrate: Math.min(tier.maxBitrate, MOBILE_TOP_TIER_BITRATE),
        }
      : { ...tier },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sampling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A raw reading pulled from `RTCPeerConnection.getStats()`. All the counter
 * fields are CUMULATIVE as reported by the browser; the controller differences
 * them internally. Callers must not pre-process them.
 */
export interface RawStatsSample {
  timestampMs: number;
  /** Smoothed-by-the-browser RTT of the nominated candidate pair, seconds. */
  rttSeconds: number | null;
  /** Cumulative `inbound-rtp.packetsLost` summed over audio + video. */
  packetsLost: number;
  /** Cumulative `inbound-rtp.packetsReceived` summed over audio + video. */
  packetsReceived: number;
  /** Cumulative `inbound-rtp.freezeCount` (video). */
  freezeCount: number;
  /** Cumulative `inbound-rtp.jitterBufferDelay` (seconds). */
  jitterBufferDelay: number;
  /** Cumulative `inbound-rtp.jitterBufferEmittedCount`. */
  jitterBufferEmittedCount: number;
  /** `outbound-rtp.qualityLimitationReason` for the video sender. */
  qualityLimitationReason: string | null;
  /** Loss reported by the peer for our video, not loss on received media. */
  outboundFractionLost?: number | null;
}

export interface QualityDecision {
  quality: ConnectionQuality;
  tierIndex: number;
  tier: VideoEncodingTier;
  /** True when `tierIndex` moved on this sample (i.e. the encoder needs a write). */
  changed: boolean;
  /** EWMA-smoothed RTT, seconds. */
  smoothedRttSeconds: number | null;
  /** Learned floor for this path (host ≈ 20 ms, TURN-relayed ≈ 90 ms). */
  baselineRttSeconds: number | null;
  /** EWMA-smoothed INTERVAL loss (0..1) — not the since-call-start average. */
  smoothedLossRate: number;
  /** Freezes observed since the previous sample. */
  freezeDelta: number;
  /** Mean jitter-buffer delay over the last interval, seconds. */
  jitterBufferSeconds: number;
  /** Short human-readable explanation, for logs. */
  reason: string;
}

// Grading thresholds. `EXCESS` values are RTT ABOVE the learned baseline, so
// they hold equally for a 20 ms LAN path and a 120 ms Cloudflare-relayed one.
const LOSS_BAD = 0.05;
const LOSS_WARN = 0.02;
const RTT_EXCESS_BAD = 0.2;
const RTT_EXCESS_WARN = 0.08;
const JITTER_BUFFER_BAD = 0.5;
const JITTER_BUFFER_WARN = 0.25;

/** EWMA weight for the newest sample. Low enough that one spike can't move the ladder. */
const EWMA_ALPHA = 0.4;

/** Consecutive clean samples required before stepping UP one rung. */
const UPSHIFT_SAMPLES = 4;
/** Extra clean samples required when the upshift also changes RESOLUTION (costs a keyframe). */
const UPSHIFT_RESOLUTION_PENALTY = 2;

/** How long we keep collecting RTT readings to learn the path baseline. */
const BASELINE_WINDOW_MS = 10_000;
const BASELINE_MIN_SAMPLES = 3;

type Grade = "good" | "warn" | "bad";

export interface QualityController {
  /** Feed one `getStats()` reading; returns the decision for this sample. */
  observe(sample: RawStatsSample): QualityDecision;
  /** Current ladder position (0 = best). */
  getTierIndex(): number;
  /** Current ladder rung. */
  getTier(): VideoEncodingTier;
  /**
   * Force a ladder position (used by the connect-time ramp so the ramp and
   * the controller can never disagree about what the encoder is doing —
   * a desync that previously left calls stuck at the 400 kbps start cap).
   */
  setTierIndex(index: number): void;
  /** Clear all learned state (new peer connection / ICE restart). */
  reset(): void;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.round((sorted.length - 1) * p)),
  );
  return sorted[idx];
}

export function createQualityController(
  options: { isMobile?: boolean } = {},
): QualityController {
  const tiers = buildTiers(!!options.isMobile);

  let tierIndex = RAMP_START_TIER_INDEX;
  let prev: RawStatsSample | null = null;
  let rttEwma: number | null = null;
  let lossEwma = 0;
  let outboundLossEwma = 0;
  let goodStreak = 0;
  let baselineRtt: number | null = null;
  let baselineSamples: number[] = [];
  let firstSampleAt: number | null = null;

  function reset() {
    tierIndex = RAMP_START_TIER_INDEX;
    prev = null;
    rttEwma = null;
    lossEwma = 0;
    outboundLossEwma = 0;
    goodStreak = 0;
    baselineRtt = null;
    baselineSamples = [];
    firstSampleAt = null;
  }

  function updateBaseline(rtt: number, timestampMs: number) {
    if (firstSampleAt === null) firstSampleAt = timestampMs;
    if (timestampMs - firstSampleAt <= BASELINE_WINDOW_MS) {
      baselineSamples.push(rtt);
      if (baselineSamples.length >= BASELINE_MIN_SAMPLES) {
        baselineRtt = percentile(
          [...baselineSamples].sort((a, b) => a - b),
          0.25,
        );
      } else if (baselineRtt === null) {
        baselineRtt = rtt;
      }
      return;
    }
    // Window closed. Keep adapting DOWNWARD only: if the path genuinely got
    // shorter (ICE switched from relay to a direct pair) the floor follows,
    // but a congestion-induced rise must never be absorbed into "normal".
    if (baselineRtt === null || rtt < baselineRtt) baselineRtt = rtt;
  }

  function observe(sample: RawStatsSample): QualityDecision {
    const previous = prev;
    prev = sample;

    // ── RTT: smooth, then learn/compare against the path baseline ────────
    if (sample.rttSeconds !== null && Number.isFinite(sample.rttSeconds)) {
      rttEwma =
        rttEwma === null
          ? sample.rttSeconds
          : EWMA_ALPHA * sample.rttSeconds + (1 - EWMA_ALPHA) * rttEwma;
      updateBaseline(rttEwma, sample.timestampMs);
    }
    if (sample.outboundFractionLost != null && Number.isFinite(sample.outboundFractionLost)) {
      outboundLossEwma =
        EWMA_ALPHA * Math.min(1, Math.max(0, sample.outboundFractionLost)) +
        (1 - EWMA_ALPHA) * outboundLossEwma;
    }

    // ── Loss: INTERVAL rate, from deltas (never the cumulative average) ──
    let intervalLoss = 0;
    if (previous) {
      const dLost = Math.max(0, sample.packetsLost - previous.packetsLost);
      const dReceived = Math.max(
        0,
        sample.packetsReceived - previous.packetsReceived,
      );
      const total = dLost + dReceived;
      if (total > 0) intervalLoss = dLost / total;
    }
    lossEwma = previous
      ? EWMA_ALPHA * intervalLoss + (1 - EWMA_ALPHA) * lossEwma
      : intervalLoss;

    // ── Freezes + jitter buffer growth since the previous sample ─────────
    const freezeDelta = previous
      ? Math.max(0, sample.freezeCount - previous.freezeCount)
      : 0;
    let jitterBufferSeconds = 0;
    if (previous) {
      const dDelay = sample.jitterBufferDelay - previous.jitterBufferDelay;
      const dEmitted =
        sample.jitterBufferEmittedCount - previous.jitterBufferEmittedCount;
      if (dEmitted > 0 && dDelay >= 0) jitterBufferSeconds = dDelay / dEmitted;
    }

    const rttExcess =
      rttEwma !== null && baselineRtt !== null
        ? Math.max(0, rttEwma - baselineRtt)
        : 0;

    // ── Grade ────────────────────────────────────────────────────────────
    let grade: Grade = "good";
    let reason = "stable";
    if (rttEwma === null) {
      // No RTT yet (call just connected) — hold position, don't guess.
      return {
        quality: "unknown",
        tierIndex,
        tier: tiers[tierIndex],
        changed: false,
        smoothedRttSeconds: null,
        baselineRttSeconds: baselineRtt,
        smoothedLossRate: lossEwma,
        freezeDelta,
        jitterBufferSeconds,
        reason: "no rtt sample yet",
      };
    }

    if (outboundLossEwma >= LOSS_BAD) {
      grade = "bad";
      reason = `uplink loss ${(outboundLossEwma * 100).toFixed(1)}%`;
    } else if (rttExcess >= RTT_EXCESS_BAD) {
      grade = "bad";
      reason = `rtt +${Math.round(rttExcess * 1000)}ms over baseline`;
    } else if (
      outboundLossEwma >= LOSS_WARN ||
      rttExcess >= RTT_EXCESS_WARN ||
      sample.qualityLimitationReason === "cpu"
    ) {
      grade = "warn";
      reason = "degrading";
    }

    // ── Move the ladder AT MOST one rung ─────────────────────────────────
    const before = tierIndex;
    if (grade === "bad") {
      goodStreak = 0;
      if (tierIndex < BOTTOM_TIER_INDEX) tierIndex += 1;
    } else if (grade === "warn") {
      // Hold. Warn is the dead-band that stops the old good↔fair flapping.
      goodStreak = 0;
    } else {
      goodStreak += 1;
      if (tierIndex > 0) {
        const next = tiers[tierIndex - 1];
        const current = tiers[tierIndex];
        const changesResolution =
          next.scaleResolutionDownBy !== current.scaleResolutionDownBy;
        const required =
          UPSHIFT_SAMPLES +
          (changesResolution ? UPSHIFT_RESOLUTION_PENALTY : 0);
        if (goodStreak >= required) {
          tierIndex -= 1;
          goodStreak = 0;
          reason = "recovered";
        }
      }
    }

    let quality: ConnectionQuality =
      grade === "good" ? "good" : grade === "warn" ? "fair" : "poor";
    if (freezeDelta > 0) {
      quality = "poor";
      reason = `${freezeDelta} inbound freeze(s)`;
    } else if (lossEwma >= LOSS_BAD) {
      quality = "poor";
      reason = `inbound loss ${(lossEwma * 100).toFixed(1)}%`;
    } else if (jitterBufferSeconds >= JITTER_BUFFER_BAD) {
      quality = "poor";
      reason = `jitter buffer ${Math.round(jitterBufferSeconds * 1000)}ms`;
    } else if (quality === "good" && (lossEwma >= LOSS_WARN || jitterBufferSeconds >= JITTER_BUFFER_WARN)) {
      quality = "fair";
      reason = "inbound degrading";
    }

    return {
      quality,
      tierIndex,
      tier: tiers[tierIndex],
      changed: tierIndex !== before,
      smoothedRttSeconds: rttEwma,
      baselineRttSeconds: baselineRtt,
      smoothedLossRate: lossEwma,
      freezeDelta,
      jitterBufferSeconds,
      reason,
    };
  }

  return {
    observe,
    getTierIndex: () => tierIndex,
    getTier: () => tiers[tierIndex],
    setTierIndex: (index: number) => {
      tierIndex = Math.min(BOTTOM_TIER_INDEX, Math.max(0, index));
      goodStreak = 0;
    },
    reset,
  };
}

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
  options: { stepMs?: number } = {},
): () => void {
  const stepMs = options.stepMs ?? 700;
  const timers: ReturnType<typeof setTimeout>[] = [];

  controller.setTierIndex(RAMP_START_TIER_INDEX);
  void applyVideoEncodingTier(pc, controller.getTier());
  void applyAudioEncodingCap(pc);

  for (let step = 1; step <= RAMP_START_TIER_INDEX; step++) {
    const target = RAMP_START_TIER_INDEX - step;
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

// ─────────────────────────────────────────────────────────────────────────────
// SDP: Opus in-band FEC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enable Opus in-band FEC (and disable DTX) on the LOCAL description before it
 * is signalled. Without `useinbandfec=1` every lost audio packet is an audible
 * gap — the most-noticed form of "jitter" on a call. FEC lets the decoder
 * reconstruct a lost packet from redundancy carried in the next one, at the
 * cost of a few kbps.
 *
 * Safe to call on any SDP: if there is no Opus fmtp line the input is returned
 * unchanged.
 */
export function preferOpusFec(sdp: string): string {
  if (!sdp) return sdp;
  // Find the Opus payload type(s) from the rtpmap lines.
  const payloadTypes = new Set<string>();
  const rtpmap = /^a=rtpmap:(\d+)\s+opus\/48000/gim;
  let match: RegExpExecArray | null;
  while ((match = rtpmap.exec(sdp))) payloadTypes.add(match[1]);
  if (payloadTypes.size === 0) return sdp;

  const wanted: Record<string, string> = {
    useinbandfec: "1",
    usedtx: "0",
    maxaveragebitrate: "32000",
  };

  return sdp
    .split(/\r\n|\n/)
    .map((line) => {
      const fmtp = /^a=fmtp:(\d+)\s+(.*)$/.exec(line);
      if (!fmtp || !payloadTypes.has(fmtp[1])) return line;
      const params = new Map<string, string>();
      for (const part of fmtp[2].split(";")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) params.set(trimmed, "");
        else params.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
      }
      for (const [key, value] of Object.entries(wanted)) params.set(key, value);
      const rebuilt = [...params.entries()]
        .map(([k, v]) => (v === "" ? k : `${k}=${v}`))
        .join(";");
      return `a=fmtp:${fmtp[1]} ${rebuilt}`;
    })
    .join("\r\n");
}

/**
 * Ask the receiver for the smallest playout buffer it can manage. Chrome
 * honours `playoutDelayHint` (seconds); other browsers ignore the property.
 * A large default buffer is what makes a call feel laggy even when the
 * network is fine.
 */
export function applyLowLatencyPlayout(
  pc: RTCPeerConnection,
  seconds = 0.05,
): void {
  for (const receiver of pc.getReceivers()) {
    try {
      (receiver as any).playoutDelayHint = seconds;
    } catch {
      /* not supported — ignore */
    }
  }
}
