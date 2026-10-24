import { describe, expect, it } from "@jest/globals";
import { callPathLabel, recordCallQuality } from "../platform/metrics/callMetrics";
import { registry, __resetForTests } from "../platform/metrics/registry";

/** prom-client 15 returns a promise from `get()`. */
async function series(name: string): Promise<any[]> {
    const metric = registry.getSingleMetric(name) as any;
    const snapshot = await metric?.get();
    return snapshot?.values ?? [];
}

async function value(name: string, labels: Record<string, string>): Promise<number> {
    const found = (await series(name)).find((v: any) =>
        Object.entries(labels).every(([k, expected]) => v.labels[k] === expected),
    );
    return found?.value ?? 0;
}

describe("call quality metrics", () => {
    it("collapses candidate types into direct / relay / unknown", () => {
        expect(callPathLabel("relay")).toBe("relay");
        expect(callPathLabel("srflx")).toBe("direct");
        expect(callPathLabel("host")).toBe("direct");
        expect(callPathLabel(null)).toBe("unknown");
        expect(callPathLabel(undefined)).toBe("unknown");
    });

    it("records a sample with path and platform labels", async () => {
        __resetForTests();
        recordCallQuality({ path: "relay", platform: "web", rttSeconds: 0.12 });
        expect(
            await value("aino_call_quality_samples_total", { path: "relay", platform: "web" }),
        ).toBe(1);
    });

    it("counts ICE restarts only when there were any", async () => {
        __resetForTests();
        recordCallQuality({ path: "relay", platform: "web", iceRestarts: 0 });
        expect(
            await value("aino_call_ice_restarts_total", { path: "relay", platform: "web" }),
        ).toBe(0);

        recordCallQuality({ path: "relay", platform: "web", iceRestarts: 2 });
        expect(
            await value("aino_call_ice_restarts_total", { path: "relay", platform: "web" }),
        ).toBe(2);
    });

    it("derives freezes per call-minute", async () => {
        __resetForTests();
        // 6 freezes over 3 minutes = 2 per minute.
        recordCallQuality({
            path: "direct",
            platform: "web",
            freezeCount: 6,
            durationSeconds: 180,
        });
        const observed = (await series("aino_call_freeze_ratio")).find(
            (v: any) => v.labels.path === "direct" && v.metricName?.endsWith("_sum"),
        );
        expect(observed?.value).toBeCloseTo(2, 5);
    });

    it("never throws on malformed input", () => {
        expect(() =>
            recordCallQuality({
                path: 123 as unknown as string,
                rttSeconds: Number.NaN,
                packetLoss: -5,
                durationSeconds: 0,
            }),
        ).not.toThrow();
    });
});
