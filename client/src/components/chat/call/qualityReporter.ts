/**
 * CALL QUALITY TELEMETRY (web / desktop)
 * ======================================
 *
 * Emits one aggregated sample per call every 30 seconds to the server, so a
 * "video froze and never recovered" report can be checked against the media
 * path, the RTT floor and the encoder tier instead of guessed at.
 *
 * Kept out of the stats loop on purpose: telemetry is fire-and-forget, must
 * never be awaited by call code, and must never throw into the sampling
 * interval.
 */

import { reportCallQuality } from "../../../api/chat";

/** How often a sample is sent. One per 30 s is ~90 bytes/min per call. */
export const QUALITY_REPORT_INTERVAL_MS = 30_000;

export interface PendingQualitySample {
  path: string | null;
  rttSeconds: number | null;
  packetLoss: number;
  freezeCount: number;
  encoderTier: number;
}

export interface QualityReporter {
  /** Record the latest reading; sends if the interval has elapsed. */
  record(sample: PendingQualitySample): void;
}

/**
 * Create a reporter for one call. `platform` distinguishes web from web-mobile
 * so a mobile-uplink problem is attributable in the metrics.
 */
export function createQualityReporter(platform: string): QualityReporter {
  const startedAt = Date.now();
  let lastReportAt = 0;

  return {
    record(sample) {
      const now = Date.now();
      if (now - lastReportAt < QUALITY_REPORT_INTERVAL_MS) return;
      lastReportAt = now;
      void reportCallQuality({
        path: sample.path,
        platform,
        rttSeconds: sample.rttSeconds,
        packetLoss: sample.packetLoss,
        freezeCount: sample.freezeCount,
        durationSeconds: (now - startedAt) / 1000,
        encoderTier: sample.encoderTier,
      });
    },
  };
}
