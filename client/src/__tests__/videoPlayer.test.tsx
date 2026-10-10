import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import VideoSurface from "../components/chat/video/VideoSurface";
import VideoThumb from "../components/chat/video/VideoThumb";
import FilePreview from "../components/chat/FilePreview";

describe("modern video player", () => {
    beforeEach(() => {
        vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
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

    test.each([false, true])("message attachment opens, plays and stops on close (caption=%s)", async (withCaption) => {
        const selectMessage = vi.fn();
        render(<div onClick={selectMessage}>
            <FilePreview fileUrl="workpulse://app/uploads/clip.mp4" fileType="video/mp4" fileName="clip.mp4" isMessage withCaption={withCaption} viewer={{ senderName: "Ann" }} />
        </div>);
        const user = userEvent.setup();
        const thumb = screen.getByRole("button", { name: /play video/i });
        thumb.focus();
        await user.keyboard("{Enter}");
        expect(selectMessage).not.toHaveBeenCalled();
        const dialog = screen.getByRole("dialog", { name: "clip.mp4" });
        const video = dialog.querySelector("video")!;
        expect(video).toHaveAttribute("src", "workpulse://app/uploads/clip.mp4");
        expect(within(dialog).getByLabelText("Pause (K)")).toBeInTheDocument();
        await user.click(within(dialog).getByLabelText("Close"));
        expect(video.paused).toBe(true);
        expect(screen.queryByRole("dialog")).toBeNull();
        thumb.focus();
        await user.keyboard(" ");
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        await user.keyboard("{Escape}");
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    test("autoplay rejection is visible and can be retried", async () => {
        vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
        render(<VideoSurface src="/v.mp4" autoPlay />);
        expect(await screen.findByRole("alert")).toHaveTextContent("Playback was blocked");
        expect(screen.getByLabelText("Play (K)")).toBeInTheDocument();
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.getByLabelText("Pause (K)")).toBeInTheDocument();
    });

    test.each([2, 3, 4])("media error %s stops waiting and retries loading", async (code) => {
        const { container } = render(<VideoSurface src="/v.mp4" />);
        const video = container.querySelector("video")!;
        fireEvent(video, new Event("waiting"));
        Object.defineProperty(video, "error", { value: { code }, configurable: true });
        fireEvent.error(video);
        expect(screen.getByRole("alert")).toHaveTextContent(code === 2 ? "could not be loaded" : "not supported");
        await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
        expect(video.load).toHaveBeenCalled();
        expect(screen.queryByRole("alert")).toBeNull();
    });

    test("manual play rejection and unsupported formats are not silent", async () => {
        vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new DOMException("unsupported", "NotSupportedError"));
        render(<VideoSurface src="/v.mp4" />);
        await act(async () => fireEvent.click(screen.getByLabelText("Play (K)")));
        expect(screen.getByRole("alert")).toHaveTextContent("format is not supported");
    });

    test("a stale play rejection cannot overwrite a new source", async () => {
        let reject!: (error: Error) => void;
        vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
        const { rerender } = render(<VideoSurface src="/old.mp4" autoPlay />);
        rerender(<VideoSurface src="/new.mp4" autoPlay />);
        await act(async () => reject(new Error("old request failed")));
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.getByLabelText("Pause (K)")).toBeInTheDocument();
    });

    test("source change clears media errors and interrupted play is not a failure", async () => {
        const { container, rerender } = render(<VideoSurface src="/old.mp4" />);
        fireEvent.error(container.querySelector("video")!);
        expect(screen.getByRole("alert")).toBeInTheDocument();
        rerender(<VideoSurface src="/new.mp4" />);
        expect(screen.queryByRole("alert")).toBeNull();
        vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new DOMException("interrupted", "AbortError"));
        await act(async () => fireEvent.click(screen.getByLabelText("Play (K)")));
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.getByLabelText("Play (K)")).toBeInTheDocument();
    });

    test("seek and playback events keep the controls synchronized", async () => {
        const { container } = render(<VideoSurface src="/v.mp4" />);
        const video = container.querySelector("video")!;
        Object.defineProperty(video, "duration", { value: 20, configurable: true });
        fireEvent.loadedMetadata(video);
        fireEvent.keyDown(screen.getByRole("region"), { key: "ArrowRight" });
        expect(video.currentTime).toBe(5);
        await act(async () => fireEvent.click(screen.getByLabelText("Play (K)")));
        fireEvent(video, new Event("waiting"));
        fireEvent(video, new Event("playing"));
        expect(screen.getByLabelText("Pause (K)")).toBeInTheDocument();
        fireEvent.ended(video);
        expect(screen.getByLabelText("Play (K)")).toBeInTheDocument();
    });
});
