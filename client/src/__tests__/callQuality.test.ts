import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAudioEncodingCap,
  applyLowLatencyPlayout,
  applyVideoEncodingTier,
  BOTTOM_TIER_INDEX,
  buildTiers,
  createQualityController,
  MOBILE_TOP_TIER_BITRATE,
  preferOpusFec,
  RAMP_START_TIER_INDEX,
  startBitrateRampUp,
  VIDEO_TIERS,
  type RawStatsSample,
} from "../components/chat/call/callQuality";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a cumulative getStats reading. The controller differences consecutive
 * samples itself, so tests must feed MONOTONIC counters exactly like the
 * browser does.
 */
function makeSample(
  overrides: Partial<RawStatsSample> & { timestampMs: number },
): RawStatsSample {
  return {
    rttSeconds: 0.1,
    packetsLost: 0,
    packetsReceived: 0,
    freezeCount: 0,
    jitterBufferDelay: 0,
    jitterBufferEmittedCount: 0,
    qualityLimitationReason: null,
    ...overrides,
  };
}

function createParameters(): RTCRtpSendParameters {
  return {
    transactionId: "",
    codecs: [],
    headerExtensions: [],
    rtcp: {},
    encodings: [],
  };
}

function createSender(
  kind: "audio" | "video",
  hooks: {
    onGet?: () => void;
    onSet?: (params: RTCRtpSendParameters) => Promise<void> | void;
  } = {},
) {
  const params = createParameters();
  const getParameters = vi.fn(() => {
    hooks.onGet?.();
    return params;
  });
  const setParameters = vi.fn(async (next: RTCRtpSendParameters) => {
    await hooks.onSet?.(next);
  });
  return { track: { kind }, getParameters, setParameters, params };
}

function createPc(senders: unknown[], receivers: unknown[] = []) {
  return {
    getSenders: () => senders,
    getReceivers: () => receivers,
  } as unknown as RTCPeerConnection;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Ladder shape
// ─────────────────────────────────────────────────────────────────────────────

describe("video tier ladder", () => {
  it("is ordered best -> worst and drops framerate with bitrate", () => {
    for (let i = 1; i < VIDEO_TIERS.length; i++) {
      expect(VIDEO_TIERS[i].maxBitrate).toBeLessThan(
        VIDEO_TIERS[i - 1].maxBitrate,
      );
      expect(VIDEO_TIERS[i].scaleResolutionDownBy).toBeGreaterThanOrEqual(
        VIDEO_TIERS[i - 1].scaleResolutionDownBy,
      );
      expect(VIDEO_TIERS[i].maxFramerate).toBeLessThanOrEqual(
        VIDEO_TIERS[i - 1].maxFramerate,
      );
    }
  });

  it("caps the top rung lower on mobile uplinks", () => {
    expect(buildTiers(false)[0].maxBitrate).toBe(VIDEO_TIERS[0].maxBitrate);
    expect(buildTiers(true)[0].maxBitrate).toBe(MOBILE_TOP_TIER_BITRATE);
    // Only the top rung differs.
    expect(buildTiers(true)[BOTTOM_TIER_INDEX]).toEqual(
      VIDEO_TIERS[BOTTOM_TIER_INDEX],
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Controller
// ─────────────────────────────────────────────────────────────────────────────

describe("quality controller", () => {
  it("holds position until it has an RTT sample", () => {
    const controller = createQualityController();
    const decision = controller.observe(
      makeSample({ timestampMs: 0, rttSeconds: null }),
    );
    expect(decision.quality).toBe("unknown");
    expect(decision.changed).toBe(false);
    expect(decision.tierIndex).toBe(RAMP_START_TIER_INDEX);
  });

  it("grades RTT against the learned path baseline, not an absolute threshold", () => {
    // A Cloudflare-TURN-relayed path sits at a steady 250 ms. The old
    // absolute classifier called that "fair" forever and kept re-configuring
    // the encoder; the baseline-relative one calls a steady path healthy.
    const controller = createQualityController();
    let decision = controller.observe(
      makeSample({ timestampMs: 0, rttSeconds: 0.25 }),
    );
    for (let i = 1; i < 5; i++) {
      decision = controller.observe(
        makeSample({ timestampMs: i * 2000, rttSeconds: 0.25 }),
      );
    }
    expect(decision.quality).toBe("good");
    expect(decision.tierIndex).toBe(RAMP_START_TIER_INDEX);
    expect(decision.baselineRttSeconds).toBeCloseTo(0.25, 3);

    // Now the SAME path degrades to 500 ms. Excess over baseline is what
    // trips the downshift, and EWMA smoothing means one spike is not enough.
    let downshifted = false;
    for (let i = 0; i < 6 && !downshifted; i++) {
      decision = controller.observe(
        makeSample({ timestampMs: 10_000 + i * 2000, rttSeconds: 0.5 }),
      );
      downshifted = decision.changed;
    }
    expect(downshifted).toBe(true);
    expect(decision.quality).toBe("poor");
    expect(decision.tierIndex).toBe(RAMP_START_TIER_INDEX + 1);
    // The baseline must not absorb a congestion-induced rise.
    expect(decision.baselineRttSeconds).toBeCloseTo(0.25, 3);
  });

  it("uses interval loss so one burst cannot pin the encoder for the whole call", () => {
    const controller = createQualityController();
    controller.observe(
      makeSample({ timestampMs: 0, packetsLost: 0, packetsReceived: 100 }),
    );

    // A single 2-second burst: 200 lost against 100 received.
    let decision = controller.observe(
      makeSample({
        timestampMs: 2000,
        packetsLost: 200,
        packetsReceived: 200,
      }),
    );
    expect(decision.quality).toBe("poor");
    expect(decision.changed).toBe(false);

    // Network recovers: no further loss, traffic keeps flowing.
    let received = 200;
    for (let i = 0; i < 6; i++) {
      received += 300;
      decision = controller.observe(
        makeSample({
          timestampMs: 4000 + i * 2000,
          packetsLost: 200,
          packetsReceived: received,
        }),
      );
    }

    // The cumulative rate the OLD code used is still ~9% (would stay "poor"
    // for the rest of the call); the interval EWMA has decayed to clean.
    const cumulativeRate = 200 / (200 + received);
    expect(cumulativeRate).toBeGreaterThan(0.05);
    expect(decision.smoothedLossRate).toBeLessThan(0.02);
    expect(decision.quality).toBe("good");
  });

  it("downshifts one rung at a time and stops at the bottom", () => {
    const controller = createQualityController();
    controller.setTierIndex(0);
    controller.observe(makeSample({ timestampMs: 0 }));

    const observed: Array<{ tierIndex: number; changed: boolean }> = [];
    for (let i = 1; i <= 5; i++) {
      const decision = controller.observe(
        makeSample({ timestampMs: i * 2000, outboundFractionLost: 0.3 }),
      );
      observed.push({
        tierIndex: decision.tierIndex,
        changed: decision.changed,
      });
    }

    expect(observed.map((o) => o.tierIndex)).toEqual([1, 2, 3, 4, 4]);
    expect(observed.map((o) => o.changed)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("does not downshift for bandwidth limitation alone", () => {
    const controller = createQualityController();
    controller.setTierIndex(1);
    controller.observe(makeSample({ timestampMs: 0 }));
    const decision = controller.observe(
      makeSample({ timestampMs: 2000, qualityLimitationReason: "bandwidth" }),
    );
    expect(decision.changed).toBe(false);
    expect(decision.tierIndex).toBe(1);
  });

  it("keeps inbound freezes visible without reconfiguring a healthy sender", () => {
    const controller = createQualityController();
    controller.setTierIndex(0);
    controller.observe(makeSample({ timestampMs: 0 }));
    for (let i = 1; i <= 10; i++) {
      const decision = controller.observe(makeSample({
        timestampMs: i * 2000,
        freezeCount: i,
        packetsLost: i * 100,
        packetsReceived: i * 100,
        jitterBufferDelay: i * 10,
        jitterBufferEmittedCount: i * 10,
      }));
      expect(decision.quality).toBe("poor");
      expect(decision.tierIndex).toBe(0);
      expect(decision.changed).toBe(false);
    }
  });

  it("recovers slowly, and even slower when the step changes resolution", () => {
    const controller = createQualityController();
    controller.observe(makeSample({ timestampMs: 0 }));
    // Uplink loss drops us from tier 3 to the bottom rung (scale 2).
    const dropped = controller.observe(
      makeSample({ timestampMs: 2000, outboundFractionLost: 0.3 }),
    );
    expect(dropped.tierIndex).toBe(BOTTOM_TIER_INDEX);
    // Let the loss EWMA recover before counting clean upshift samples.
    for (let i = 0; i < 4; i++) {
      controller.observe(makeSample({ timestampMs: 4000 + i * 2000, outboundFractionLost: 0 }));
    }
    controller.setTierIndex(BOTTOM_TIER_INDEX);

    // Tier 4 -> tier 3 changes scaleResolutionDownBy (2 -> 1.5), which costs
    // a keyframe, so it needs the extra damping: 4 + 2 = 6 clean samples.
    let decision = dropped;
    for (let i = 0; i < 5; i++) {
      decision = controller.observe(
        makeSample({ timestampMs: 12_000 + i * 2000, outboundFractionLost: 0 }),
      );
      expect(decision.quality).toBe("good");
      expect(decision.changed).toBe(false);
      expect(decision.tierIndex).toBe(BOTTOM_TIER_INDEX);
    }
    decision = controller.observe(
      makeSample({ timestampMs: 22_000, outboundFractionLost: 0 }),
    );
    expect(decision.changed).toBe(true);
    expect(decision.tierIndex).toBe(BOTTOM_TIER_INDEX - 1);
  });

  it("needs only four clean samples when the step keeps the resolution", () => {
    const controller = createQualityController();
    // Tier 2 -> tier 1: both render at scaleResolutionDownBy = 1.
    controller.setTierIndex(2);
    let decision = controller.observe(makeSample({ timestampMs: 0 }));
    for (let i = 1; i <= 2; i++) {
      decision = controller.observe(makeSample({ timestampMs: i * 2000 }));
      expect(decision.changed).toBe(false);
    }
    decision = controller.observe(makeSample({ timestampMs: 6000 }));
    expect(decision.changed).toBe(true);
    expect(decision.tierIndex).toBe(1);
  });

  it("holds position in the warn dead-band instead of flapping", () => {
    const controller = createQualityController();
    // Learn a 100 ms baseline.
    for (let i = 0; i < 4; i++) {
      controller.observe(makeSample({ timestampMs: i * 2000 }));
    }
    // RTT settles at 220 ms: ~120 ms over baseline, i.e. between the warn and
    // bad thresholds. Let the EWMA converge into that band first.
    let decision = controller.observe(makeSample({ timestampMs: 0 }));
    for (let i = 0; i < 3; i++) {
      decision = controller.observe(
        makeSample({ timestampMs: 8000 + i * 2000, rttSeconds: 0.22 }),
      );
    }
    expect(decision.quality).toBe("fair");

    // Sustained mid-band excess must HOLD the ladder: no downshift (it is not
    // bad) and no upshift (warn resets the recovery streak). This dead-band is
    // what stops the old good<->fair flapping that re-configured the encoder
    // every few seconds.
    const start = controller.getTierIndex();
    for (let i = 0; i < 6; i++) {
      decision = controller.observe(
        makeSample({ timestampMs: 14_000 + i * 2000, rttSeconds: 0.22 }),
      );
      expect(decision.quality).toBe("fair");
      expect(decision.tierIndex).toBe(start);
      expect(decision.changed).toBe(false);
    }
  });

  it("relearns the RTT floor when the media path changes, instead of pinning the ladder", () => {
    // Regression: a call that connects on a direct path (≈20 ms) and then
    // recovers from an ICE failure onto a TURN relay (≈120 ms) used to grade
    // the relayed path against the direct-path floor forever. Excess RTT was
    // permanently "bad", so the ladder walked to the bottom rung and stayed
    // there — the "reconnects, then quality drops" symptom.
    const controller = createQualityController();
    const direct = { localCandidateType: "srflx", remoteCandidateType: "srflx" };
    const relayed = { localCandidateType: "relay", remoteCandidateType: "srflx" };

    let decision = controller.observe(
      makeSample({ timestampMs: 0, rttSeconds: 0.02, ...direct }),
    );
    for (let i = 1; i < 6; i++) {
      decision = controller.observe(
        makeSample({ timestampMs: i * 2000, rttSeconds: 0.02, ...direct }),
      );
    }
    expect(decision.baselineRttSeconds).toBeCloseTo(0.02, 3);
    const tierBeforePathChange = decision.tierIndex;

    // ICE restart: the nominated pair becomes relayed and RTT jumps to 120 ms.
    for (let i = 0; i < 8; i++) {
      decision = controller.observe(
        makeSample({
          timestampMs: 20_000 + i * 2000,
          rttSeconds: 0.12,
          ...relayed,
        }),
      );
    }

    // The new floor is learned (well above the old 20 ms direct-path floor),
    // so a steady relayed path grades healthy and the ladder is NOT dragged
    // toward the bottom rung.
    expect(decision.baselineRttSeconds).toBeGreaterThan(0.06);
    expect(decision.quality).toBe("good");
    expect(decision.tierIndex).toBeLessThanOrEqual(tierBeforePathChange);
  });

  it("still downshifts on a relayed path that is genuinely congested", () => {
    // Relearning must not make the controller blind: a relayed path whose RTT
    // climbs well above its OWN floor still degrades.
    const controller = createQualityController();
    const relayed = { localCandidateType: "relay", remoteCandidateType: "srflx" };
    let decision = controller.observe(
      makeSample({ timestampMs: 0, rttSeconds: 0.12, ...relayed }),
    );
    for (let i = 1; i < 6; i++) {
      decision = controller.observe(
        makeSample({ timestampMs: i * 2000, rttSeconds: 0.12, ...relayed }),
      );
    }
    const healthyTier = decision.tierIndex;

    let downshifted = false;
    for (let i = 0; i < 8 && !downshifted; i++) {
      decision = controller.observe(
        makeSample({
          timestampMs: 20_000 + i * 2000,
          rttSeconds: 0.6,
          ...relayed,
        }),
      );
      downshifted = decision.changed;
    }
    expect(downshifted).toBe(true);
    expect(decision.tierIndex).toBe(healthyTier + 1);
  });

  it("clears learned state on reset", () => {
    const controller = createQualityController();
    controller.observe(makeSample({ timestampMs: 0 }));
    controller.observe(makeSample({ timestampMs: 2000, outboundFractionLost: 0.3 }));
    expect(controller.getTierIndex()).toBe(BOTTOM_TIER_INDEX);
    controller.reset();
    expect(controller.getTierIndex()).toBe(RAMP_START_TIER_INDEX);
    expect(
      controller.observe(makeSample({ timestampMs: 0, rttSeconds: null }))
        .baselineRttSeconds,
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Encoder writes
// ─────────────────────────────────────────────────────────────────────────────

describe("encoder parameter writes", () => {
  it("applies bitrate, framerate and scale to video senders only", async () => {
    const video = createSender("video");
    const audio = createSender("audio");
    const pc = createPc([video, audio]);

    await expect(
      applyVideoEncodingTier(pc, VIDEO_TIERS[BOTTOM_TIER_INDEX]),
    ).resolves.toBe(true);

    expect(video.params.encodings[0]).toMatchObject({
      maxBitrate: 150_000,
      maxFramerate: 15,
      scaleResolutionDownBy: 2,
    });
    expect(video.params.degradationPreference).toBe("balanced");
    expect(video.setParameters).toHaveBeenCalledWith(video.params);
    expect(audio.setParameters).not.toHaveBeenCalled();
  });

  it("caps audio separately so video adaptation cannot starve it", async () => {
    const video = createSender("video");
    const audio = createSender("audio");
    const pc = createPc([video, audio]);

    await expect(applyAudioEncodingCap(pc)).resolves.toBe(true);
    expect(audio.params.encodings[0].maxBitrate).toBe(48_000);
    expect(video.setParameters).not.toHaveBeenCalled();
  });

  it("serialises concurrent writes and re-reads parameters for each one", async () => {
    const log: string[] = [];
    const video = createSender("video", {
      onGet: () => log.push("get"),
      onSet: (params) =>
        new Promise<void>((resolve) => {
          log.push(`set:${params.encodings[0].maxBitrate}`);
          setTimeout(resolve, 5);
        }),
    });
    const pc = createPc([video]);

    // Two writers racing, exactly like the connect ramp and the stats loop.
    const first = applyVideoEncodingTier(pc, VIDEO_TIERS[0]);
    const second = applyVideoEncodingTier(pc, VIDEO_TIERS[BOTTOM_TIER_INDEX]);
    await Promise.all([first, second]);

    // A fresh getParameters() must precede each setParameters(); never
    // get/get/set/set, which is what throws InvalidStateError.
    expect(log).toEqual([
      "get",
      `set:${VIDEO_TIERS[0].maxBitrate}`,
      "get",
      `set:${VIDEO_TIERS[BOTTOM_TIER_INDEX].maxBitrate}`,
    ]);
    // Last writer wins.
    expect(video.params.encodings[0].maxBitrate).toBe(
      VIDEO_TIERS[BOTTOM_TIER_INDEX].maxBitrate,
    );
  });

  it("reports failures instead of swallowing them, and keeps the queue alive", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = createSender("video", {
      onSet: () => Promise.reject(new Error("InvalidStateError")),
    });
    const pc = createPc([failing]);

    await expect(applyVideoEncodingTier(pc, VIDEO_TIERS[0])).resolves.toBe(
      false,
    );
    expect(warn).toHaveBeenCalled();

    // A later write on the same peer connection still runs.
    failing.setParameters.mockImplementation(async () => {});
    await expect(applyVideoEncodingTier(pc, VIDEO_TIERS[1])).resolves.toBe(
      true,
    );
  });

  it("asks receivers for a small playout buffer", () => {
    const receiver: Record<string, unknown> = {};
    applyLowLatencyPlayout(createPc([], [receiver]), 0.05);
    expect(receiver.playoutDelayHint).toBe(0.05);
  });

  it("does not hide one rejected video sender behind another successful sender", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = createSender("video", {
      onSet: () => Promise.reject(new Error("InvalidStateError")),
    });
    const succeeding = createSender("video");
    await expect(
      applyVideoEncodingTier(createPc([failing, succeeding]), VIDEO_TIERS[0]),
    ).resolves.toBe(false);
    expect(succeeding.setParameters).toHaveBeenCalledOnce();
  });

  it("treats a voice call with no video sender as an applied no-op", async () => {
    const audio = createSender("audio");
    await expect(
      applyVideoEncodingTier(createPc([audio]), VIDEO_TIERS[0]),
    ).resolves.toBe(true);
    expect(audio.setParameters).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Connect-time ramp
// ─────────────────────────────────────────────────────────────────────────────

describe("connect-time bitrate ramp", () => {
  it("walks up one rung per step and shares its position with the controller", () => {
    vi.useFakeTimers();
    const controller = createQualityController();
    const pc = createPc([createSender("video"), createSender("audio")]);

    const cancel = startBitrateRampUp(pc, controller, { stepMs: 100 });
    expect(controller.getTierIndex()).toBe(RAMP_START_TIER_INDEX);

    vi.advanceTimersByTime(100);
    expect(controller.getTierIndex()).toBe(RAMP_START_TIER_INDEX - 1);
    vi.advanceTimersByTime(200);
    expect(controller.getTierIndex()).toBe(0);
    cancel();
  });

  it("aborts as soon as the adaptive controller has moved down", () => {
    vi.useFakeTimers();
    const controller = createQualityController();
    const pc = createPc([createSender("video")]);

    startBitrateRampUp(pc, controller, { stepMs: 100 });
    vi.advanceTimersByTime(100);
    expect(controller.getTierIndex()).toBe(RAMP_START_TIER_INDEX - 1);

    // The stats loop drops us because the link is genuinely bad.
    controller.setTierIndex(BOTTOM_TIER_INDEX);
    vi.advanceTimersByTime(500);
    expect(controller.getTierIndex()).toBe(BOTTOM_TIER_INDEX);
  });

  it("stops stepping once cancelled", () => {
    vi.useFakeTimers();
    const controller = createQualityController();
    const pc = createPc([createSender("video")]);

    const cancel = startBitrateRampUp(pc, controller, { stepMs: 100 });
    cancel();
    vi.advanceTimersByTime(1000);
    expect(controller.getTierIndex()).toBe(RAMP_START_TIER_INDEX);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SDP munging
// ─────────────────────────────────────────────────────────────────────────────

describe("preferOpusFec", () => {
  it("turns on in-band FEC while preserving unrelated fmtp params", () => {
    const sdp = [
      "v=0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111 110",
      "a=rtpmap:111 opus/48000/2",
      "a=fmtp:111 minptime=10;useinbandfec=0",
      "a=rtpmap:110 telephone-event/48000",
      "a=fmtp:110 0-15",
    ].join("\r\n");

    const out = preferOpusFec(sdp);
    const opusFmtp = out
      .split("\r\n")
      .find((line) => line.startsWith("a=fmtp:111"))!;

    expect(opusFmtp).toContain("minptime=10");
    expect(opusFmtp).toContain("useinbandfec=1");
    expect(opusFmtp).toContain("usedtx=0");
    expect(opusFmtp).toContain("maxaveragebitrate=32000");
    expect(opusFmtp).not.toContain("useinbandfec=0");
    // Other payload types are untouched.
    expect(out).toContain("a=fmtp:110 0-15");
  });

  it("is a no-op when there is no Opus line", () => {
    const sdp =
      "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 VP8/90000";
    expect(preferOpusFec(sdp)).toBe(sdp);
    expect(preferOpusFec("")).toBe("");
  });
});
