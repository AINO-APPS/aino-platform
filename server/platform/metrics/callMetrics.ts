/**
 * WebRTC call-quality telemetry.
 *
 * Why
 * ───
 * Calls could stall, freeze or silently degrade to the bottom bitrate rung and
 * nothing in the observability stack noticed: the only call-related signals
 * were generic WS/API health. A "video froze and never recovered" report was
 * therefore unfalsifiable — there was no record of the media path, the RTT
 * floor, the encoder tier or the number of ICE restarts.
 *
 * Clients now report one aggregated sample per call (and on every ICE restart)
 * to `POST /api/chat/calls/quality`. These series make the failure modes
 * visible:
 *
 *   aino_call_ice_restarts_total{path}      — how often the media path moved
 *   aino_call_quality_samples_total{path}   — relay vs direct share of calls
 *   aino_call_freeze_ratio                  — inbound freezes per call-minute
 *   aino_call_encoder_tier                  — where the ladder ended up
 *   aino_call_rtt_seconds                   — measured RTT by path type
 *
 * `path` is the nominated candidate-pair type (`direct`, `relay`, `unknown`).
 * A relayed call is expected to sit at a higher RTT; comparing the two in one
 * histogram is what makes "quality dropped after reconnect" obvious.
 */
import { Counter, Histogram } from "prom-client";
import { registry } from "./registry";

/**
 * prom-client throws on duplicate registration and Jest resets modules between
 * suites while the registry singleton survives, so reuse an existing series.
 */
function counter(name: string, help: string, labelNames: string[]): Counter<string> {
    const existing = registry.getSingleMetric(name);
    if (existing) return existing as Counter<string>;
    return new Counter({ name, help, labelNames, registers: [registry] });
}

function histogram(
    name: string,
    help: string,
    labelNames: string[],
    buckets: number[],
): Histogram<string> {
    const existing = registry.getSingleMetric(name);
    if (existing) return existing as Histogram<string>;
    return new Histogram({ name, help, labelNames, buckets, registers: [registry] });
}

const qualitySamples = counter(
    "aino_call_quality_samples_total",
    "Call quality samples reported by clients, by media path.",
    ["path", "platform"],
);

const iceRestarts = counter(
    "aino_call_ice_restarts_total",
    "ICE restarts / relay rebuilds reported by clients, by media path.",
    ["path", "platform"],
);

const callRtt = histogram(
    "aino_call_rtt_seconds",
    "Round-trip time of the nominated candidate pair.",
    ["path"],
    [0.02, 0.05, 0.1, 0.2, 0.4, 0.8, 1.5, 3],
);

const callFreezeRatio = histogram(
    "aino_call_freeze_ratio",
    "Inbound video freezes per call-minute (0 = smooth).",
    ["path"],
    [0, 0.01, 0.05, 0.1, 0.5, 1, 5],
);

const callEncoderTier = histogram(
    "aino_call_encoder_tier",
    "Final adaptive-ladder rung (0 = best, higher = more degraded).",
    ["path"],
    [0, 1, 2, 3, 4],
);

const callPacketLoss = histogram(
    "aino_call_packet_loss_ratio",
    "Smoothed inbound packet loss for the call.",
    ["path"],
    [0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.3],
);

/** Candidate-pair types collapse to the three buckets that matter operationally. */
export function callPathLabel(localCandidateType?: string | null): "direct" | "relay" | "unknown" {
    if (!localCandidateType) return "unknown";
    return localCandidateType === "relay" ? "relay" : "direct";
}

export interface CallQualityReport {
    path?: string | null;
    platform?: string | null;
    rttSeconds?: number | null;
    packetLoss?: number | null;
    freezeCount?: number | null;
    durationSeconds?: number | null;
    encoderTier?: number | null;
    iceRestarts?: number | null;
}

/**
 * Record one client report. Every field is optional and every failure is
 * swallowed: telemetry must never break a call or a request.
 */
export function recordCallQuality(report: CallQualityReport): void {
    try {
        const path = callPathLabel(report.path);
        const platform = (report.platform || "unknown").toLowerCase().slice(0, 16);

        qualitySamples.inc({ path, platform });

        if (typeof report.rttSeconds === "number" && Number.isFinite(report.rttSeconds)) {
            callRtt.observe({ path }, Math.max(0, report.rttSeconds));
        }
        if (typeof report.packetLoss === "number" && Number.isFinite(report.packetLoss)) {
            callPacketLoss.observe({ path }, Math.min(1, Math.max(0, report.packetLoss)));
        }
        if (typeof report.encoderTier === "number" && Number.isFinite(report.encoderTier)) {
            callEncoderTier.observe({ path }, Math.max(0, report.encoderTier));
        }
        if (typeof report.iceRestarts === "number" && report.iceRestarts > 0) {
            iceRestarts.inc({ path, platform }, Math.min(100, report.iceRestarts));
        }
        if (
            typeof report.freezeCount === "number" &&
            typeof report.durationSeconds === "number" &&
            report.durationSeconds > 0
        ) {
            const minutes = report.durationSeconds / 60;
            callFreezeRatio.observe({ path }, Math.max(0, report.freezeCount) / minutes);
        }
    } catch {
        /* metrics must never break a call */
    }
}
