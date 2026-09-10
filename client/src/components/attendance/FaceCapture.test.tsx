import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import FaceCapture from "./FaceCapture";

const mocks = vi.hoisted(() => ({
    loadFaceModels: vi.fn(),
    extractDescriptor: vi.fn(),
    detectFaceScore: vi.fn(),
    getWebcamStream: vi.fn(),
    stopStream: vi.fn(),
}));

vi.mock("../../utils/faceApi", () => mocks);

describe("FaceCapture automatic verification", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        mocks.loadFaceModels.mockResolvedValue(undefined);
        mocks.getWebcamStream.mockResolvedValue({ getTracks: () => [] });
        mocks.detectFaceScore.mockResolvedValue(0.9);
        mocks.extractDescriptor.mockResolvedValue([0.1, 0.2, 0.3]);
        vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
        Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
            configurable: true,
            get: () => HTMLMediaElement.HAVE_CURRENT_DATA,
        });
    });

    test("captures and submits automatically after one strong face detection", async () => {
        const onCapture = vi.fn().mockResolvedValue(true);
        render(<FaceCapture autoStart autoCapture onCapture={onCapture} />);

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(500);
        });

        expect(onCapture).toHaveBeenCalledOnce();
        expect(mocks.extractDescriptor).toHaveBeenCalledOnce();
    });

    test("does not restart or duplicate capture when the callback identity changes", async () => {
        const firstCapture = vi.fn().mockResolvedValue(true);
        const secondCapture = vi.fn().mockResolvedValue(true);
        const { rerender } = render(
            <FaceCapture autoStart autoCapture onCapture={firstCapture} />,
        );

        await act(async () => { await Promise.resolve(); });
        rerender(<FaceCapture autoStart autoCapture onCapture={secondCapture} />);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });

        expect(firstCapture).not.toHaveBeenCalled();
        expect(secondCapture).toHaveBeenCalledOnce();
        expect(mocks.extractDescriptor).toHaveBeenCalledOnce();
    });
});