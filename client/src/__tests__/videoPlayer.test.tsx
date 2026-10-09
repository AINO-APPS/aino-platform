import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import VideoSurface from "../components/chat/video/VideoSurface";
import VideoThumb from "../components/chat/video/VideoThumb";

describe("modern video player", () => {
    beforeEach(() => {
        vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
            Object.defineProperty(this, "paused", { value: false, configurable: true });
            this.dispatchEvent(new Event("play"));
            return Promise.resolve();
        });
        vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
            Object.defineProperty(this, "paused", { value: true, configurable: true });
            this.dispatchEvent(new Event("pause"));
        });
    });

    test("custom controls: play/pause, keyboard shortcuts, speed menu", () => {
        const { container } = render(<VideoSurface src="/v.mp4" fileName="clip.mp4" />);
        const video = container.querySelector("video") as HTMLVideoElement;
        expect(video.hasAttribute("controls")).toBe(false);

        fireEvent.click(screen.getByLabelText("Play (K)"));
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
        expect(screen.getByLabelText("Pause (K)")).toBeInTheDocument();

        fireEvent.keyDown(screen.getByRole("region", { name: "clip.mp4" }), { key: "k" });
        expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();

        fireEvent.keyDown(screen.getByRole("region", { name: "clip.mp4" }), { key: "m" });
        expect(video.muted).toBe(true);

        fireEvent.click(screen.getByLabelText("Playback speed"));
        fireEvent.click(screen.getByRole("menuitemradio", { name: "1.5x" }));
        expect(video.playbackRate).toBe(1.5);
        expect(screen.getByRole("slider", { name: "Seek" })).toBeInTheDocument();
        expect(screen.getByLabelText("Download")).toHaveAttribute("href", "/v.mp4");
    });

    test("thumbnail opens a Teams-style viewer with sender header", async () => {
        const onForward = vi.fn();
        render(<VideoThumb fileUrl="/v.mp4" fileName="clip.mp4" viewer={{ senderName: "Ann", sentAt: "2026-01-01T10:00:00Z", onForward }} />);
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: /play video/i }));
        });
        const dialog = screen.getByRole("dialog", { name: "clip.mp4" });
        expect(dialog).toBeInTheDocument();
        expect(screen.getByText("Ann")).toBeInTheDocument();
        fireEvent.click(screen.getByLabelText("Forward"));
        expect(onForward).toHaveBeenCalled();
        expect(screen.queryByRole("dialog", { name: "clip.mp4" })).toBeNull();
    });
});
