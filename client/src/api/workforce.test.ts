import { beforeEach, describe, expect, test, vi } from "vitest";

const mockPost = vi.fn();

vi.mock("./client", () => ({
    default: {
        get: vi.fn(),
        post: (...args: unknown[]) => mockPost(...args),
        put: vi.fn(),
        delete: vi.fn(),
    },
}));

import { clockIn, clockOut } from "./workforce";

describe("workforce clockIn", () => {
    beforeEach(() => {
        mockPost.mockReset();
        mockPost.mockResolvedValue({ data: { ok: true } });
    });

    test("forwards every verified clock-in signal including Wi-Fi BSSID", async () => {
        const faceDescriptor = [0.1, 0.2, 0.3];

        await clockIn({
            work_mode: "office",
            latitude: 12.34,
            longitude: 56.78,
            accuracy: 15,
            face_descriptor: [0.1, 0.2, 0.3],
            wifi_bssid: "AA:BB:CC:DD:EE:FF",
        });

        expect(mockPost).toHaveBeenCalledWith("/tracker/clock-in", {
            work_mode: "office",
            latitude: 12.34,
            longitude: 56.78,
            accuracy: 15,
            face_descriptor: faceDescriptor,
            wifi_bssid: "AA:BB:CC:DD:EE:FF",
        });
    });
});

describe("workforce clockOut", () => {
    beforeEach(() => {
        mockPost.mockReset();
        mockPost.mockResolvedValue({ data: { ok: true } });
    });

    test("forwards office presence and face verification signals", async () => {
        const faceDescriptor = new Float32Array([0.1, 0.2, 0.3]);

        await clockOut({
            latitude: 12.34,
            longitude: 56.78,
            accuracy: 15,
            face_descriptor: faceDescriptor,
            wifi_bssid: "AA:BB:CC:DD:EE:FF",
        });

        expect(mockPost).toHaveBeenCalledWith("/tracker/clock-out", {
            latitude: 12.34,
            longitude: 56.78,
            accuracy: 15,
            face_descriptor: Array.from(faceDescriptor),
            wifi_bssid: "AA:BB:CC:DD:EE:FF",
        });
    });
});