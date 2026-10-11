import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useCallControls from "../components/chat/call/useCallControls";
import { createQualityController } from "../components/chat/call/callQuality";

function stats(rtt: number, videoLoss: number, audioLoss = 0): RTCStatsReport {
  return new Map([
    ["pair", { id: "pair", timestamp: 0, type: "candidate-pair", nominated: true, currentRoundTripTime: rtt }],
    ["video", { id: "video", timestamp: 0, type: "remote-inbound-rtp", kind: "video", fractionLost: videoLoss }],
    ["audio", { id: "audio", timestamp: 0, type: "remote-inbound-rtp", kind: "audio", fractionLost: audioLoss }],
  ]) as RTCStatsReport;
}

function setup(reports: RTCStatsReport[]) {
  const controller = createQualityController();
  controller.setTierIndex(0);
  controller.observe({
    timestampMs: 0, rttSeconds: 0.1, packetsLost: 0, packetsReceived: 0,
    freezeCount: 0, jitterBufferDelay: 0, jitterBufferEmittedCount: 0,
    qualityLimitationReason: null,
  });
  const setParameters = vi.fn().mockResolvedValue(undefined);
  const sender = {
    track: { kind: "video" },
    getParameters: () => ({ encodings: [{}] }),
    setParameters,
  };
  let index = 0;
  const pc = {
    getStats: vi.fn(async () => reports[Math.min(index++, reports.length - 1)]),
    getSenders: () => [sender],
  } as unknown as RTCPeerConnection;
  const { result, unmount } = renderHook(() => useCallControls({
    localStreamRef: { current: null },
    pcRef: { current: pc },
    screenStreamRef: { current: null },
    screenSenderRef: { current: null },
    localVideoRef: { current: null },
    remoteVideoRef: { current: null },
    overlayRef: { current: null },
    qualityControllerRef: { current: controller },
  }));
  const interval = result.current.startQualityMonitor(pc);
  return { controller, setParameters, stop: () => { clearInterval(interval); unmount(); } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("quality monitor sender feedback", () => {
  it("uses remote video loss to reduce our sender cap", async () => {
    const monitor = setup([stats(0.1, 0.3)]);
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(monitor.controller.getTierIndex()).toBe(1);
      expect(monitor.setParameters).toHaveBeenCalledOnce();
    } finally {
      monitor.stop();
    }
  });

  it("does not mistake remote audio loss for video uplink loss", async () => {
    const monitor = setup([stats(0.1, 0, 0.9)]);
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
      expect(monitor.controller.getTierIndex()).toBe(0);
      expect(monitor.setParameters).not.toHaveBeenCalled();
    } finally {
      monitor.stop();
    }
  });

  it("retries a rejected video tier on the next sample even when the tier holds", async () => {
    const monitor = setup([stats(0.7, 0), stats(0.1, 0)]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    monitor.setParameters.mockRejectedValueOnce(new Error("encoder not ready"));
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(monitor.controller.getTierIndex()).toBe(1);
      expect(monitor.setParameters).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(monitor.controller.getTierIndex()).toBe(1);
      expect(monitor.setParameters).toHaveBeenCalledTimes(2);
      expect(console.warn).toHaveBeenCalled();
    } finally {
      monitor.stop();
    }
  });
});
