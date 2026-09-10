import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import ClockInVerifyModal from "./ClockInVerifyModal";

const mocks = vi.hoisted(() => ({
    getCurrentOrg: vi.fn(),
    getCurrentPosition: vi.fn(),
    getWifiInfo: vi.fn(),
    faceProps: vi.fn(),
}));

vi.mock("../../api/organization", () => ({
    getCurrentOrg: mocks.getCurrentOrg,
}));

vi.mock("../../utils/geolocation", () => ({
    getCurrentPosition: mocks.getCurrentPosition,
    getWifiInfo: mocks.getWifiInfo,
    geolocationErrorMessage: () => "Location unavailable",
}));

vi.mock("../../utils/faceApi", () => ({
    preloadFaceModels: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
    const actual = await importOriginal<typeof import("react-router-dom")>();
    return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("./FaceCapture", () => ({
    default: (props: Record<string, unknown>) => {
        mocks.faceProps(props);
        return <div data-testid="face-capture" data-auto={String(props.autoCapture)} />;
    },
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

describe("ClockInVerifyModal fast verification", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCurrentOrg.mockResolvedValue({
            data: {
                office_wifi_verification_enabled: true,
                office_wifi_bssids: [{ bssid: "AA:BB:CC:DD:EE:FF" }],
            },
        });
    });

    test("mounts the camera immediately and enables auto-capture on registered Wi-Fi without waiting for location", async () => {
        const location = deferred<{ latitude: number; longitude: number; accuracy: number; source: "native" }>();
        mocks.getCurrentPosition.mockReturnValue(location.promise);
        mocks.getWifiInfo.mockResolvedValue({
            ok: true,
            bssid: "aa-bb-cc-dd-ee-ff",
            ssid: "Office",
        });

        const submitAttendance = vi.fn().mockResolvedValue({ data: { ok: true } });
        render(
            <ClockInVerifyModal
                action="clock-out"
                workMode="office"
                submitAttendance={submitAttendance}
            />,
        );

        expect(screen.getByTestId("face-capture")).toHaveAttribute("data-auto", "false");
        await waitFor(() => {
            expect(screen.getByTestId("face-capture")).toHaveAttribute("data-auto", "true");
        });
        expect(screen.getByText(/office network detected/i)).toBeInTheDocument();

        const latestProps = mocks.faceProps.mock.calls.at(-1)?.[0] as {
            onCapture: (descriptor: number[]) => Promise<boolean>;
        };
        await act(async () => {
            await Promise.all([
                latestProps.onCapture([0.1, 0.2]),
                latestProps.onCapture([0.3, 0.4]),
            ]);
        });
        expect(submitAttendance).toHaveBeenCalledOnce();

        await act(async () => {
            location.resolve({ latitude: 1, longitude: 2, accuracy: 20, source: "native" });
            await location.promise;
        });
    });

    test("keeps auto-capture gated until location resolves for an unregistered Wi-Fi network", async () => {
        const location = deferred<{ latitude: number; longitude: number; accuracy: number; source: "native" }>();
        mocks.getCurrentPosition.mockReturnValue(location.promise);
        mocks.getWifiInfo.mockResolvedValue({
            ok: true,
            bssid: "11:22:33:44:55:66",
            ssid: "Guest",
        });

        render(
            <ClockInVerifyModal
                workMode="office"
                submitAttendance={vi.fn()}
            />,
        );

        await waitFor(() => expect(mocks.getWifiInfo).toHaveBeenCalledOnce());
        expect(screen.getByTestId("face-capture")).toHaveAttribute("data-auto", "false");

        await act(async () => {
            location.resolve({ latitude: 1, longitude: 2, accuracy: 20, source: "native" });
            await location.promise;
        });

        await waitFor(() => {
            expect(screen.getByTestId("face-capture")).toHaveAttribute("data-auto", "true");
        });
        expect(screen.getByText(/not a registered office AP/i)).toBeInTheDocument();
    });
});